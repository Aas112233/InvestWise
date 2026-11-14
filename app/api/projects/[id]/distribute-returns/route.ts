import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, members, funds, transactions, systemSettings } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, inArray, or, like, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { LockedError, NotFoundError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { projectReturnDistributionSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from '../../_helpers';
import {
  parsePositiveAmount,
  splitByPercent,
  splitDividendByShares,
  parsePercentBp,
  toCents,
  fromCents,
  clampLossToEquity,
} from '@/lib/money';
import {
  distributionRulesToBp,
  parseProjectType,
  splitProjectPool,
  assertProjectDistributionContract,
  effectiveProjectMemberBp,
  isProjectMemberRole,
} from '@/lib/distribution-rules';
import type { MemberRole } from '@/lib/member-roles';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import crypto from 'node:crypto';
import { apiError } from '@/lib/utils/api-error';

// The run locks the project + every fund + every recipient row and writes
// grouped ledger rows — keep headroom over the 10s serverless default.
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const body = await readJsonBody(request);
    const parsed = projectReturnDistributionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: zodMessage(parsed.error) },
        { status: 400 },
      );
    }
    const { type, description, settleProject } = parsed.data;
    // Settle & close: the legs are computed server-side from the project's
    // locked balance — client amounts don't exist for this run shape.
    const isSettle = settleProject === true;
    let distributionAmountCents: number;
    if (isSettle) {
      distributionAmountCents = 0; // replaced by the locked balance inside the transaction
    } else {
      try {
        // Project postings outscale member-level deposits (see updates route) —
        // ceiling 999,999,999.99 instead of the 10M member-transaction default.
        distributionAmountCents = parsePositiveAmount(parsed.data.amount as number, { field: 'amount', maxCents: 99_999_999_999 });
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : 'Invalid amount');
      }
    }
    // "Both": the loss leg (schema guarantees it is present and > 0).
    let lossAmountCents: number | null = null;
    if (type === 'Both') {
      try {
        lossAmountCents = parsePositiveAmount(parsed.data.lossAmount as number, { field: 'lossAmount', maxCents: 99_999_999_999 });
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : 'Invalid loss amount');
      }
    }

    // Fund recipients are a profit-leg feature (schema rejects them for Loss;
    // for Both they apply to the profit leg). Parse each percent to integer
    // basis points, reject duplicates, and cap the total at 100% before any
    // DB work. Shareholders take the remaining percentage.
    let fundPlan: Array<{ fundId: string; bp: number }> | null = null;
    const fundPercentBp = new Map<string, number>();
    // Fund recipients apply to the profit leg: every custom Profit/Both run,
    // and every settle run (the settle leg IS the profit leg).
    const fundsAllowed = isSettle || type !== 'Loss';
    if (fundsAllowed && parsed.data.fundAllocations && parsed.data.fundAllocations.length > 0) {
      const seen = new Set<string>();
      for (const fa of parsed.data.fundAllocations) {
        if (seen.has(fa.fundId)) {
          throw new ValidationError('A fund appears more than once in the allocations');
        }
        seen.add(fa.fundId);
        let bp: number;
        try {
          bp = parsePercentBp(fa.percent, 'fundAllocations.percent');
        } catch (err) {
          throw new ValidationError(err instanceof Error ? err.message : 'Invalid fund percent');
        }
        fundPercentBp.set(fa.fundId, bp);
        fundPlan = (fundPlan ?? []);
        fundPlan.push({ fundId: fa.fundId, bp });
      }
      const totalBp = [...fundPercentBp.values()].reduce((a, b) => a + b, 0);
      if (totalBp > 10_000) {
        throw new ValidationError('Fund percentages must not exceed 100% in total');
      }
    }
    const recipientFundIds = fundPlan ? fundPlan.map((f) => f.fundId) : [];

    // §12 idempotency: the run reference doubles as the retry key. Payout rows
    // carry `${refBase}-${seq}` refs, so the dup-check matches both forms.
    const refBase = parsed.data.referenceNumber?.trim() ||
      `PRJ-RET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const db = getDb();

    const distributionResult = await db.transaction(async (tx) => {
      // 1. Lock and fetch project
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
        .for('update')
        .limit(1);

      if (!project) throw new NotFoundError('Project');

      // Settled & closed projects are immutable records — no further runs.
      if (project.isLocked) {
        throw new LockedError(
          'This project is completed and permanently locked — its returns can no longer be distributed.',
        );
      }

      // #74 (same rule, second door): a distribution without a fund pays members
      // from money that exists nowhere. The equity write-back below still raises
      // every recipient's `total_contributed` and the ledger rows land with
      // `fund_id IS NULL`, so no fund statement can show the payout and the
      // treasury never shrinks — 18 such rows (1,179,999.92 BDT) are sitting in
      // the default tenant's ledger from before this guard existed.
      if (!project.linkedFundId) {
        throw new ValidationError(
          'This project has no linked fund, so its returns cannot be distributed. Link an existing fund or create its dedicated fund first.',
        );
      }

      // §12 idempotency: a retry with the same reference must not pay twice.
      // The project row lock above serializes same-project retries.
      const likeEscaped = refBase.replace(/[\\%_]/g, (m) => `\\${m}`);
      const [dupe] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, tenantId),
            eq(transactions.isDeleted, false),
            or(
              eq(transactions.referenceNumber, refBase),
              like(transactions.referenceNumber, `${likeEscaped}-%`),
            ),
          ),
        )
        .limit(1);
      if (dupe) {
        throw new ValidationError('Transaction with this reference number already exists');
      }

      // 2. Lock the linked fund (source of funds) and every recipient fund in a
      //    single deterministic pass (funds-before-members order, ascending id).
      //    The same ordering the dividend run uses, so a concurrent profit
      //    distribution and dividend run can never deadlock across routes.
      const fundIdsToLock = Array.from(new Set([project.linkedFundId!, ...recipientFundIds])).sort();
      const lockedFunds = await tx
        .select({ id: funds.id, name: funds.name, balance: funds.balance, currency: funds.currency })
        .from(funds)
        .where(and(inArray(funds.id, fundIdsToLock), eq(funds.tenantId, tenantId)))
        .orderBy(funds.id)
        .for('update');
      const fundById = new Map(lockedFunds.map((f) => [f.id, f]));

      if (!fundById.get(project.linkedFundId!)) throw new NotFoundError('Linked fund');
      const linkedFund = fundById.get(project.linkedFundId!)!;
      const linkedCurrency = (linkedFund.currency ?? '').trim().toUpperCase();
      for (const fid of recipientFundIds) {
        const recipient = fundById.get(fid);
        if (!recipient) throw new NotFoundError('Recipient fund');
        // Same guard as fund transfers: mixing two currencies in one payout
        // would book an amount in the wrong unit on the recipient's statement.
        const recipientCurrency = (recipient.currency ?? '').trim().toUpperCase();
        if (linkedCurrency && recipientCurrency && linkedCurrency !== recipientCurrency) {
          throw new ValidationError(
            `Cannot distribute returns from ${linkedFund.name} (${linkedCurrency}) to ${recipient.name} (${recipientCurrency}) — currency mismatch`,
          );
        }
      }
      const linkedFundBalanceCents = toCents(linkedFund.balance || '0');

      // 3. Fetch project shareholders (deterministic order)
      const shareholders = await tx
        .select({
          memberId: projectMembers.memberId,
          memberName: memberDisplayNameSql,
          memberRole: members.role,
          sharesInvested: projectMembers.sharesInvested,
          ownershipPercentage: projectMembers.ownershipPercentage,
        })
        .from(projectMembers)
        .innerJoin(members, and(eq(projectMembers.memberId, members.id), eq(members.tenantId, tenantId)))
        .where(eq(projectMembers.projectId, id))
        .orderBy(projectMembers.memberId);

      // Lock member rows in deterministic order: the equity snapshots feed the
      // ledger balanceBefore/After and cap loss absorption. An empty roster is
      // skipped outright (funds-only distributions are legal for such projects).
      const shareholderIds = shareholders.map((s) => s.memberId).sort();
      const lockedMembers =
        shareholderIds.length > 0
          ? await tx
              .select({ id: members.id, equity: members.totalContributed })
              .from(members)
              .where(and(inArray(members.id, shareholderIds), eq(members.tenantId, tenantId)))
              .orderBy(members.id)
              .for('update')
          : [];
      const equityAtLock = new Map<string, number>();
      for (const m of lockedMembers) {
        equityAtLock.set(m.id, toCents(m.equity ?? '0'));
      }

      const currentBalanceCents = toCents(project.currentFundBalance || '0');

      // Per-category distribution rules (Settings → Financial → Returns
      // distribution, docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md). Read at RUN time
      // — like fund balances, a run uses the rules as configured when it
      // executes; editing rules never rewrites past runs. Empty = the exact
      // historical pro-rata behavior. A corrupt stored config fails the run
      // LOUDLY (the parser throws) rather than silently mis-splitting money.
      const [settingsRow] = await tx
        .select({ distributionRules: systemSettings.distributionRules })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1);
      // Project type (migration 0032, docs/PROJECT-TYPES_PLAN.md). The resolver
      // owns the difference: club_level spends the category rules (with this
      // project's PM override merged in, exactly as before), extra_investor
      // carves the PM contract first and splits the remainder purely by share
      // number — no category rules, so the v9 Σ>100 conflict cannot arise here.
      let clubRulesBp: Map<MemberRole, number>;
      let projectType: ReturnType<typeof parseProjectType>;
      try {
        clubRulesBp = distributionRulesToBp(settingsRow?.distributionRules ?? null);
        projectType = parseProjectType(project.projectType);
      } catch (err) {
        throw new ValidationError(
          'The category distribution rules in effect for this project are invalid — check Settings → Financial → Returns distribution and this project\u2019s Project Level Member percentage: ' +
            (err instanceof Error ? err.message : ''),
        );
      }
      // Category-weighted splits read each shareholder's membership category; a
      // null role defaults to the standard 'Shareholder Member' category (the
      // column default since the six-category vocabulary, migration 0029).
      const splitMembers = shareholders.map((s) => ({
        id: s.memberId,
        shares: Number(s.sharesInvested || 0),
        role: s.memberRole ?? 'Shareholder Member',
      }));

      // Fail EARLY and by name on a contract the project cannot honour (a club
      // project holding PMs, or an extra-investor project with PMs and no
      // percentage) — before any leg math, so the message is the admin's to fix
      // rather than a split error mid-run.
      try {
        assertProjectDistributionContract({
          projectType,
          projectMemberPercent: project.projectMemberPercent,
          members: splitMembers,
        });
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : 'Invalid project distribution contract');
      }

      const now = new Date();
      await assertFiscalPeriodOpen(tx, tenantId, now);

      // ---- Legs. "Both" settles two legs in one atomic run: the profit leg
      //      first (credits shareholder equity, may pay funds), then the loss
      //      leg (debits equity — its absorption cap therefore includes the
      //      profit just credited). Single-leg runs are a one-element loop, so
      //      their behavior is unchanged.
      //      Settle & close: the ENTIRE remaining balance is the profit leg —
      //      the updates-route overdraft guard keeps it >= 0, so a settle never
      //      needs a loss leg (the project's losses already depleted this
      //      balance). A zero balance is a no-op close.
      const customType: 'Profit' | 'Loss' | 'Both' = isSettle
        ? 'Profit'
        : (type as 'Profit' | 'Loss' | 'Both');
      const profitLegCents = isSettle ? Math.max(0, currentBalanceCents) : distributionAmountCents;
      const lossLegCents = isSettle
        ? 0
        : customType === 'Both'
          ? (lossAmountCents as number)
          : customType === 'Loss'
            ? distributionAmountCents
            : 0;
      const legTypes: Array<'Profit' | 'Loss'> = isSettle
        ? profitLegCents > 0
          ? ['Profit']
          : []
        : customType === 'Both'
          ? ['Profit', 'Loss']
          : [customType];

      let runningBalanceCents = currentBalanceCents;
      // Running member equity: the loss leg's absorption cap is computed from
      // this, so in a Both run it includes the profit credits just applied.
      const equityRunning = new Map(equityAtLock);

      let refSeq = 0;
      const nextRef = () => `${refBase}-${(String(++refSeq)).padStart(2, '0')}`;

      const fundDeltaCents = new Map<string, number>();
      const fundPayoutFinal = new Map<string, number>();
      let fundsTotalCents = 0;
      let memberAppliedTotalCents = 0;
      let lossAppliedTotalCents = 0;
      // Loss the shareholders' equity could not absorb. Reported in the result
      // and the audit payload: without it the gap between a requested Loss and
      // what reached `totalExpenses` is untraceable (§12 conservation).
      let lossUnabsorbedCents = 0;
      const membersWithPayout = new Set<string>();
      // Category carve-out traceability (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md):
      // how much each member category claimed and the pro-rata remainder left
      // outside the configured categories, summed across the run's legs. Only
      // populated when rules are configured (an empty list is the old pro-rata).
      const typeAllocationTotal = new Map<string, number>();
      let typeRemainderTotalCents = 0;
      // True whenever the split is not the plain pro-rata one: category rules are
      // configured (club_level) or the project carries a PM contract
      // (extra_investor, where the contract block is recorded even with no rules).
      const categoryRulesActive = clubRulesBp.size > 0 || projectType === 'extra_investor';
      const distributionsList: Array<{
        memberId: string;
        memberName: string;
        shares: number;
        requestedAmount: string;
        appliedAmount: string;
        type: 'Profit' | 'Loss';
      }> = [];
      const fundLedgerRows: Array<typeof transactions.$inferInsert> = [];
      const memberLedgerRows: Array<typeof transactions.$inferInsert> = [];

      for (const legType of legTypes) {
        const isProfit = legType === 'Profit';
        const requestedCents = isProfit ? profitLegCents : lossLegCents;

        // 4. Split the amount: funds first (profit leg only, by percent),
        //    shareholders get the remaining percentage pro-rata by shares.
        //    Both splits are exact integer-cent, so funds + members ===
        //    distribution to the cent.
        let fundPayoutCents = new Map<string, number>();
        let legFundsCents = 0;
        if (isProfit && fundPlan && fundPlan.length > 0) {
          let split: Array<{ id: string; bp: number; payoutCents: number }>;
          try {
            split = splitByPercent(
              requestedCents,
              fundPlan.map((f) => ({ id: f.fundId, bp: f.bp })),
            );
          } catch (err) {
            throw new ValidationError(
              err instanceof Error ? err.message : 'Cannot split distribution across funds',
            );
          }
          legFundsCents = split.reduce((s, p) => s + p.payoutCents, 0);
          for (const p of split) {
            if (p.payoutCents > 0) fundPayoutCents.set(p.id, p.payoutCents);
          }
        }
        const membersTotalCents = requestedCents - legFundsCents;

        // Sufficiency: the linked fund (source) must absorb the FULL amount at
        // its locked balance — the old GREATEST(0, ...) clamp silently
        // absorbed any shortfall; that drift is now a hard, unmasked failure.
        if (isProfit) {
          if (linkedFundBalanceCents < requestedCents) {
            throw new ValidationError(
              `Insufficient linked fund balance for profit payout (Available: ${fromCents(linkedFundBalanceCents)}, Required: ${fromCents(requestedCents)})`,
            );
          }
          if (runningBalanceCents < requestedCents) {
            throw new ValidationError(
              `Insufficient project fund balance for profit payout (Available: ${fromCents(runningBalanceCents)}, Required: ${fromCents(requestedCents)})`,
            );
          }
        }

        // Member split of the remaining percentage, per project type
        // (lib/distribution-rules::splitProjectPool — one resolver, so the
        // preview and this run cannot disagree):
        //   club_level      each configured member category carves its percent of
        //                   this pool, then pro-rata by shares inside the
        //                   category; the unclaimed remainder stays pro-rata
        //                   across unconfigured members. No rules = the exact
        //                   historical pro-rata split, byte-identical.
        //   extra_investor  the PM contract is carved first (split equally
        //                   between the PMs), then the remainder goes purely by
        //                   share number across Board + Shareholder.
        let requestedMap = new Map<string, number>();
        let appliedMap = new Map<string, number>();
        if (membersTotalCents > 0) {
          if (shareholders.length === 0) {
            throw new ValidationError(
              'No active shareholders found to receive the member portion of this distribution',
            );
          }
          try {
            const memberSplit = splitProjectPool({
              projectType,
              poolCents: membersTotalCents,
              members: splitMembers,
              clubRulesBp,
              projectMemberPercent: project.projectMemberPercent,
            });
            requestedMap = new Map(memberSplit.payouts.map((s) => [s.id, s.payoutCents]));
            appliedMap = new Map(requestedMap);
            if (categoryRulesActive) {
              for (const block of memberSplit.typeBlocks) {
                typeAllocationTotal.set(block.role, (typeAllocationTotal.get(block.role) ?? 0) + block.amountCents);
              }
              typeRemainderTotalCents += memberSplit.remainderCents;
            }
          } catch (err) {
            throw new ValidationError(
              err instanceof Error
                ? `Cannot split the member portion across shareholders: ${err.message}`
                : 'Cannot split distribution across shareholders',
            );
          }
        }

        // Loss: a debit can never exceed the member's recorded equity. Clamp
        // each over-cap debit and re-allocate the shortfall to shareholders
        // with remaining equity. Every pass fully consumes at least one
        // member's equity, so the loop is bounded; the final clamp after the
        // loop guarantees the invariant unconditionally. (Profit pays out; it
        // is never clamped against equity.) The cap is the RUNNING equity, so
        // in a Both run it includes the profit just credited.
        if (!isProfit) {
          // The clamp itself is pure and tested independently
          // (lib/money.ts::clampLossToEquity). The shortfall re-credit stays
          // CATEGORY-WEIGHTED for a club project: the same engine re-splits it
          // across only the members that still have equity left (each carries its
          // own category, so blocks recompute within that subset).
          const clamp = clampLossToEquity(
            appliedMap,
            equityRunning,
            (shortfall, candidates) => {
              const byId = new Map(shareholders.map((s) => [s.memberId, s]));
              try {
                if (projectType === 'extra_investor') {
                  // No contract carve on a SHORTFALL: the PMs already took their
                  // contract share of the requested loss, and a candidate set
                  // with no PM could not pay a fresh carve-out at all — cents
                  // may never go unbooked (§12). The shortfall follows shares.
                  return splitDividendByShares(
                    shortfall,
                    candidates.map((c) => ({ id: c.id, shares: c.shares })),
                  );
                }
                return splitProjectPool({
                  projectType,
                  poolCents: shortfall,
                  members: candidates.map((c) => ({
                    id: c.id,
                    shares: c.shares,
                    role: byId.get(c.id)?.memberRole ?? 'Shareholder Member',
                  })),
                  clubRulesBp,
                  projectMemberPercent: project.projectMemberPercent,
                }).payouts;
              } catch (err) {
                throw new ValidationError(
                  `Cannot re-allocate the loss shortfall across shareholders: ${err instanceof Error ? err.message : 'split failed'}`,
                );
              }
            },
            new Map(shareholders.map((s) => [s.memberId, Number(s.sharesInvested || 0)])),
          );
          appliedMap = clamp.appliedCents;
          lossUnabsorbedCents += clamp.unabsorbedCents;
        }

        const recipients = shareholders
          .map((sh) => {
            const applied = appliedMap.get(sh.memberId) ?? 0;
            const beforeCents = equityRunning.get(sh.memberId) ?? 0;
            return {
              sh,
              applied,
              beforeCents,
              afterCents: isProfit ? beforeCents + applied : beforeCents - applied,
            };
          })
          .filter((r) => r.applied > 0);

        // §12 loss mirror: the equity shareholders surrender must be written
        // down through the project fund, the linked fund and the project's
        // expense books by the same cents. Pre-validate sufficiency at the
        // running balances BEFORE any ledger write. In a Both run the linked
        // fund must already cover the profit leg's full draw PLUS this loss.
        const legLossCents = isProfit ? 0 : recipients.reduce((acc, r) => acc + r.applied, 0);
        if (legLossCents > 0) {
          if (runningBalanceCents < legLossCents) {
            throw new ValidationError(
              `Insufficient project fund balance to absorb the loss (Available: ${fromCents(runningBalanceCents)}, Required: ${fromCents(legLossCents)})`,
            );
          }
          const linkedRequired = (type === 'Both' ? distributionAmountCents : 0) + legLossCents;
          if (linkedFundBalanceCents < linkedRequired) {
            throw new ValidationError(
              `Insufficient linked fund balance to absorb the loss (Available: ${fromCents(linkedFundBalanceCents)}, Required: ${fromCents(linkedRequired)})`,
            );
          }
        }

        // 5. Ledger: per-fund Dividend rows (profit leg) + per-shareholder
        //    equity rows. Reference numbers share one sequence (fund rows
        //    first, then member rows, leg by leg) so the idempotency
        //    dup-check (refBase-%) covers every leg.
        for (const [fid, payout] of [...fundPayoutCents.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          const fund = fundById.get(fid);
          if (!fund) continue;
          const balBefore = toCents(fund.balance || '0');
          fundLedgerRows.push({
            tenantId,
            // 'Transfer In', not 'Dividend'. This row records money ARRIVING in
            // a recipient fund — its own balanceAfter below is balBefore +
            // payout — while 'Dividend' is classified as an OUTFLOW by
            // INFLOW_TYPES/OUTFLOW_TYPES everywhere else in the ledger. The
            // mismatch made the double-entry unrepresentable: reconcileFund
            // read a +3,000 receipt as a -3,000 payment and reported a 6,000
            // discrepancy on correct books. 'Dividend' is kept on the
            // per-shareholder rows below, where it genuinely is a payout.
            // Mirrors the #97 paired-leg approach the general dividend route
            // already uses.
            type: 'Transfer In',
            amount: fromCents(payout),
            description: `Project profit return to ${fund.name} (${project.title}): ${description.trim()}`,
            category: 'Profit Distribution',
            referenceNumber: nextRef(),
            date: now,
            submittedDate: now,
            status: 'Completed',
            memberId: null,
            projectId: id,
            fundId: fid,
            handlingOfficer: user.name,
            balanceBefore: fromCents(balBefore),
            balanceAfter: fromCents(balBefore + payout),
            createdBy: user.id,
          });
        }

        // Matching source leg. The linked fund is debited the whole profit leg
        // (`legFundOutCents` below), but the per-member 'Dividend' rows booked
        // against it only cover the shareholders' share, so the portion routed
        // to other funds had no outflow leg on the fund that actually paid it —
        // the same one-sided gap #97 fixed on the general dividend route with a
        // reserve/Transfer-Out pair. Without this row the source fund's ledger
        // and its balance disagree by exactly `legFundsCents`.
        if (isProfit && legFundsCents > 0 && project.linkedFundId) {
          const srcFund = fundById.get(project.linkedFundId);
          const srcBalBefore = toCents(srcFund?.balance || '0');
          fundLedgerRows.push({
            tenantId,
            type: 'Transfer Out',
            amount: fromCents(legFundsCents),
            description: `Project profit routed to other funds (${project.title}): ${description.trim()}`,
            category: 'Profit Distribution',
            referenceNumber: nextRef(),
            date: now,
            submittedDate: now,
            status: 'Completed',
            memberId: null,
            projectId: id,
            fundId: project.linkedFundId,
            handlingOfficer: user.name,
            balanceBefore: fromCents(srcBalBefore),
            balanceAfter: fromCents(srcBalBefore - legFundsCents),
            createdBy: user.id,
          });
        }

        for (const r of recipients) {
          memberLedgerRows.push({
            tenantId,
            type: isProfit ? 'Dividend' : 'Expense',
            amount: fromCents(r.applied),
            description: isProfit
              ? `Project profit return (${project.title}): ${description.trim()}`
              : `Project loss absorption (${project.title}): ${description.trim()}`,
            category: isProfit ? 'Profit Distribution' : 'Loss Allocation',
            referenceNumber: nextRef(),
            date: now,
            submittedDate: now,
            status: 'Completed',
            memberId: r.sh.memberId,
            projectId: id,
            fundId: project.linkedFundId ?? null,
            handlingOfficer: user.name,
            balanceBefore: fromCents(r.beforeCents),
            balanceAfter: fromCents(r.afterCents),
            createdBy: user.id,
          });
          memberAppliedTotalCents += r.applied;
          if (!isProfit) lossAppliedTotalCents += r.applied;
          membersWithPayout.add(r.sh.memberId);
          distributionsList.push({
            memberId: r.sh.memberId,
            memberName: r.sh.memberName,
            shares: Number(r.sh.sharesInvested || 0),
            requestedAmount: fromCents(requestedMap.get(r.sh.memberId) ?? 0),
            appliedAmount: fromCents(r.applied),
            type: legType,
          });
        }

        // Apply the leg to the running state.
        if (isProfit) {
          runningBalanceCents -= requestedCents;
          fundsTotalCents += legFundsCents;
          for (const [fid, payout] of fundPayoutCents) fundPayoutFinal.set(fid, payout);
        } else {
          runningBalanceCents -= legLossCents;
        }
        for (const r of recipients) equityRunning.set(r.sh.memberId, r.afterCents);
        // The linked fund must go out by EXACTLY what moved elsewhere in this
        // leg, or the money has no destination. On a profit leg that is the full
        // requested amount, which is what gets split to shareholders and funds.
        // On a loss leg it is `legLossCents` — what the shareholders actually
        // absorbed — because the project balance and their equity are reduced by
        // that capped figure two lines above, and the balance guard at :421
        // already sizes the linked-fund requirement as `... + legLossCents`.
        // Debiting `requestedCents` here instead made the fund pay out more than
        // anyone received: whenever a member's shares could not absorb the full
        // loss, the difference left the fund with no ledger behind it and the
        // project silently diverged from its own linked fund.
        const legFundOutCents = isProfit ? requestedCents : legLossCents;
        fundDeltaCents.set(project.linkedFundId!, (fundDeltaCents.get(project.linkedFundId!) ?? 0) - legFundOutCents);
        for (const [fid, payout] of fundPayoutCents) {
          fundDeltaCents.set(fid, (fundDeltaCents.get(fid) ?? 0) + payout);
        }
      }

      // 6. Write-backs (grouped — N recipients cost a few round-trips, not N).
      const finalRecipients = shareholders
        .map((sh) => ({ sh, finalCents: equityRunning.get(sh.memberId) ?? 0 }))
        .filter((r) => r.finalCents !== (equityAtLock.get(r.sh.memberId) ?? 0));
      if (finalRecipients.length > 0) {
        // Grouped equity write-back under the row locks held above — the §6
        // tenant predicate stays in the WHERE.
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = v.balance::numeric,
              updated_at = ${now.toISOString()}::timestamptz
          FROM (VALUES ${sql.join(
            finalRecipients.map((r) => sql`(${r.sh.memberId}::uuid, ${fromCents(r.finalCents)}::numeric)`),
            sql`, `
          )}) AS v(id, balance)
          WHERE m.id = v.id AND m.tenant_id = ${tenantId}
        `);
      }

      if (fundLedgerRows.length > 0 || memberLedgerRows.length > 0) {
        await tx.insert(transactions).values([...fundLedgerRows, ...memberLedgerRows]);
      }

      // Fund books. The linked fund is the SOURCE: it is debited the full
      // distribution; each recipient fund is credited its share. If the linked
      // fund is also a recipient its net delta is (-full + share). Applied as
      // one grouped UPDATE with relative deltas (row locks held, so
      // f.balance + delta is exact with no clamping).
      if (fundDeltaCents.size > 0) {
        await tx.execute(sql`
          UPDATE ${funds} AS f
          SET balance = (f.balance::numeric + v.delta::numeric(15,2)),
              updated_at = ${now.toISOString()}::timestamptz
          FROM (VALUES ${sql.join(
            [...fundDeltaCents.entries()].map(
              ([k, v]) => sql`(${k}::uuid, ${fromCents(v)}::numeric(15,2))`,
            ),
            sql`, `
          )}) AS v(id, delta)
          WHERE f.id = v.id AND f.tenant_id = ${tenantId}
        `);
      }

      // Project books. Profit pays out of the project fund; Loss mirrors it.
      // (A Loss run that absorbed nothing leaves the project row untouched.)
      // Settle & close: after the payout the books are zero — the same write
      // flips status to Completed and sets the permanent lock. is_locked is
      // one-way: no code path ever clears it.
      if (customType === 'Profit' || customType === 'Both' || lossAppliedTotalCents > 0) {
        const projectSet: Record<string, unknown> = {
          currentFundBalance: fromCents(runningBalanceCents),
          updatedAt: now,
        };
        if (lossAppliedTotalCents > 0) {
          projectSet.totalExpenses = fromCents(toCents(project.totalExpenses || '0') + lossAppliedTotalCents);
        }
        if (isSettle) {
          projectSet.status = 'Completed';
          projectSet.completionDate = now.toISOString().slice(0, 10);
          projectSet.isLocked = true;
        }
        await tx
          .update(projects)
          .set(projectSet)
          .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
      }

      const fundDistributionsList: Array<{
        fundId: string;
        fundName: string;
        percent: string;
        amount: string;
      }> = [...fundPayoutFinal.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([fid, payout]) => ({
          fundId: fid,
          fundName: fundById.get(fid)?.name ?? '',
          percent: fromCents(fundPercentBp.get(fid) ?? 0),
          amount: fromCents(payout),
        }));

      // Category carve-out summary for the run (only when rules are active):
      // what each member category claimed and what stayed in the pro-rata
      // remainder — the paper trail the audit and the UI toast both quote.
      // The PM row's percent is the project's effective contract (override →
      // club rule), which on an Extra Investor project is the only percent the
      // PM category ever spends.
      const pmEffectiveBp = effectiveProjectMemberBp(clubRulesBp, project.projectMemberPercent);
      const categoryAllocations = [...typeAllocationTotal.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([role, cents]) => ({
          role,
          percent: fromCents(
            isProjectMemberRole(role) ? (pmEffectiveBp ?? 0) : (clubRulesBp.get(role as MemberRole) ?? 0),
          ),
          amount: fromCents(cents),
        }));

      return {
        type: customType,
        requestedAmount: fromCents(profitLegCents + (customType === 'Both' ? lossLegCents : 0)),
        totalDistributed: fromCents(memberAppliedTotalCents + fundsTotalCents),
        totalToMembers: fromCents(memberAppliedTotalCents),
        totalToFunds: fromCents(fundsTotalCents),
        ...(customType === 'Both'
          ? {
              profitAmount: fromCents(profitLegCents),
              lossRequested: fromCents(lossLegCents),
              lossAllocated: fromCents(lossAppliedTotalCents),
            }
          : {}),
        // Present on every loss-bearing run (pure Loss, Both, and a settled
        // Loss), not just Both: a pure Loss had no loss field at all, so the
        // shortfall between requested and `totalExpenses` was unrecoverable.
        ...(customType === 'Loss' || customType === 'Both'
          ? { lossUnabsorbed: fromCents(lossUnabsorbedCents) }
          : {}),
        ...(isSettle ? { settled: true, locked: true } : {}),
        shareholderCount: membersWithPayout.size,
        fundCount: fundDistributionsList.length,
        distributions: distributionsList,
        fundDistributions: fundDistributionsList,
        ...(categoryRulesActive
          ? { categoryAllocations, remainderAmount: fromCents(typeRemainderTotalCents) }
          : {}),
      };
    });

    const fundNote =
      distributionResult.fundCount > 0
        ? ` and ${distributionResult.fundCount} fund${distributionResult.fundCount > 1 ? 's' : ''}`
        : '';
    let message: string;
    if (isSettle) {
      message =
        toCents(distributionResult.requestedAmount) > 0
          ? `Project settled: ${distributionResult.requestedAmount} (the entire remaining balance) distributed across ${distributionResult.shareholderCount} shareholder${distributionResult.shareholderCount === 1 ? '' : 's'}${fundNote}. The project is now marked Completed and permanently locked.`
          : 'Project settled: no remaining balance to distribute. The project is now marked Completed and permanently locked.';
    } else if (type === 'Both') {
      const lossRequestedStr = fromCents(lossAmountCents as number);
      const lossAllocatedStr = distributionResult.lossAllocated ?? '0.00';
      message =
        toCents(distributionResult.lossUnabsorbed ?? '0.00') > 0
          ? `Project returns distribution executed: ${distributionResult.profitAmount} profit and ${lossAllocatedStr} of ${lossRequestedStr} loss applied; some shareholders had insufficient equity to absorb their loss share`
          : `Project returns distribution executed: ${distributionResult.profitAmount} profit and ${lossRequestedStr} loss across ${distributionResult.shareholderCount} shareholder${distributionResult.shareholderCount === 1 ? '' : 's'}${fundNote}`;
    } else {
      message =
        type === 'Loss' && toCents(distributionResult.lossUnabsorbed ?? '0.00') > 0
          ? `Project loss distribution applied ${distributionResult.totalDistributed} of ${distributionResult.requestedAmount} requested; some shareholders had insufficient equity to absorb their share`
          : `Project ${distributionResult.type.toLowerCase()} distribution executed successfully across ${distributionResult.shareholderCount} shareholder${distributionResult.shareholderCount === 1 ? '' : 's'}${fundNote}`;
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'DISTRIBUTE_PROJECT_RETURNS',
      resourceType: 'Project',
      resourceId: id,
      details: {
        type,
        ...(isSettle ? { settled: true, locked: true } : {}),
        amount: distributionResult.totalDistributed,
        requestedAmount: distributionResult.requestedAmount,
        totalToMembers: distributionResult.totalToMembers,
        totalToFunds: distributionResult.totalToFunds,
        ...(type === 'Both'
          ? {
              lossRequested: distributionResult.lossRequested,
              lossAllocated: distributionResult.lossAllocated,
            }
          : {}),
        ...(type === 'Loss' || type === 'Both'
          ? { lossUnabsorbed: distributionResult.lossUnabsorbed ?? '0.00' }
          : {}),
        shareholderCount: distributionResult.shareholderCount,
        fundCount: distributionResult.fundCount,
        // Category carve-out only exists when the run used rules; absent
        // otherwise, so historical audit rows keep their exact old shape.
        ...('categoryAllocations' in distributionResult
          ? {
              categoryAllocations: distributionResult.categoryAllocations,
              remainderAmount: distributionResult.remainderAmount,
            }
          : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: distributionResult,
      message,
    });
  } catch (err: unknown) {
    console.error('[PROJECT RETURN DISTRIBUTION ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return apiError(e, 'Failed to distribute project returns');
  }
}
