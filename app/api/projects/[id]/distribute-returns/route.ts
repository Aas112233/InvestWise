import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, members, funds, transactions } from '@/db/schema/index';
import { eq, and, inArray, or, like, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { projectReturnDistributionSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from '../../_helpers';
import {
  parsePositiveAmount,
  splitDividendByShares,
  splitByPercent,
  parsePercentBp,
  toCents,
  fromCents,
} from '@/lib/money';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import crypto from 'node:crypto';

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
    const { type, description } = parsed.data;
    let distributionAmountCents: number;
    try {
      // Project postings outscale member-level deposits (see updates route) —
      // ceiling 999,999,999.99 instead of the 10M member-transaction default.
      distributionAmountCents = parsePositiveAmount(parsed.data.amount, { field: 'amount', maxCents: 99_999_999_999 });
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Invalid amount');
    }

    // Fund recipients are Profit-only (schema already rejects Loss). Parse each
    // percent to integer basis points, reject duplicates, and cap the total at
    // 100% before any DB work. Shareholders take the remaining percentage.
    let fundPlan: Array<{ fundId: string; bp: number }> | null = null;
    const fundPercentBp = new Map<string, number>();
    if (type === 'Profit' && parsed.data.fundAllocations && parsed.data.fundAllocations.length > 0) {
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
          memberName: members.name,
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
      const remainingEquity = new Map(equityAtLock);

      const currentBalanceCents = toCents(project.currentFundBalance || '0');

      // ---- Split the amount: funds first (by percent), shareholders get the
      //      remaining percentage pro-rata by shares. Both splits are exact
      //      integer-cent, so funds + members === distribution to the cent.
      let fundPayoutCents = new Map<string, number>();
      let fundsTotalCents = 0;
      if (type === 'Profit' && fundPlan && fundPlan.length > 0) {
        let split: Array<{ id: string; bp: number; payoutCents: number }>;
        try {
          split = splitByPercent(
            distributionAmountCents,
            fundPlan.map((f) => ({ id: f.fundId, bp: f.bp })),
          );
        } catch (err) {
          throw new ValidationError(
            err instanceof Error ? err.message : 'Cannot split distribution across funds',
          );
        }
        fundsTotalCents = split.reduce((s, p) => s + p.payoutCents, 0);
        for (const p of split) {
          if (p.payoutCents > 0) fundPayoutCents.set(p.id, p.payoutCents);
        }
      }
      const membersTotalCents = distributionAmountCents - fundsTotalCents;

      // Sufficiency: the linked fund (source) must absorb the FULL amount at its
      // locked balance — the old GREATEST(0, ...) clamp silently absorbed any
      // shortfall; that drift is now a hard, unmasked failure.
      if (type === 'Profit' && linkedFundBalanceCents < distributionAmountCents) {
        throw new ValidationError(
          `Insufficient linked fund balance for profit payout (Available: ${fromCents(linkedFundBalanceCents)}, Required: ${fromCents(distributionAmountCents)})`,
        );
      }
      if (type === 'Profit' && currentBalanceCents < distributionAmountCents) {
        throw new ValidationError(
          `Insufficient project fund balance for profit payout (Available: ${fromCents(currentBalanceCents)}, Required: ${fromCents(distributionAmountCents)})`,
        );
      }

      const now = new Date();
      await assertFiscalPeriodOpen(tx, tenantId, now);

      // ---- Member split of the remaining percentage.
      let requestedCents = new Map<string, number>();
      let appliedCents = new Map<string, number>();
      if (membersTotalCents > 0) {
        if (shareholders.length === 0) {
          throw new ValidationError(
            'No active shareholders found to receive the member portion of this distribution',
          );
        }
        try {
          const memberSplit = splitDividendByShares(
            membersTotalCents,
            shareholders.map((s) => ({ id: s.memberId, shares: Number(s.sharesInvested || 0) })),
          );
          requestedCents = new Map(memberSplit.map((s) => [s.id, s.payoutCents]));
          appliedCents = new Map(requestedCents);
        } catch (err) {
          throw new ValidationError(
            err instanceof Error
              ? `Cannot split the member portion across shareholders: ${err.message}`
              : 'Cannot split distribution across shareholders',
          );
        }
      }

      // 4. Loss: a debit can never exceed the member's recorded equity. Clamp
      //    each over-cap debit and re-allocate the shortfall to shareholders
      //    with remaining equity. Every pass fully consumes at least one
      //    member's equity, so the loop is bounded; the final clamp after the
      //    loop guarantees the invariant unconditionally. (Profit pays out; it
      //    is never clamped against equity.)
      if (type === 'Loss') {
        for (let pass = 0; pass < shareholders.length; pass++) {
          const overCap = shareholders.filter(
            (s) => (appliedCents.get(s.memberId) ?? 0) > (remainingEquity.get(s.memberId) ?? 0),
          );
          if (overCap.length === 0) break;
          let shortfall = 0;
          for (const sh of overCap) {
            const cap = remainingEquity.get(sh.memberId) ?? 0;
            shortfall += (appliedCents.get(sh.memberId) ?? 0) - cap;
            appliedCents.set(sh.memberId, cap);
            remainingEquity.set(sh.memberId, 0); // equity fully consumed
          }
          const candidates = shareholders.filter(
            (s) => Number(s.sharesInvested || 0) > 0 && (remainingEquity.get(s.memberId) ?? 0) > 0,
          );
          if (candidates.length === 0) break; // equity exhausted; record actual debits only
          const candidateShares = candidates.reduce((acc, s) => acc + Number(s.sharesInvested || 0), 0);
          let reallocated = 0;
          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (!c) continue;
            const add = i === candidates.length - 1
              ? shortfall - reallocated
              : Math.floor((shortfall * Number(c.sharesInvested || 0)) / candidateShares);
            reallocated += add;
            appliedCents.set(c.memberId, (appliedCents.get(c.memberId) ?? 0) + add);
          }
        }
        // Applied debits can never exceed the equity recorded at lock time.
        for (const sh of shareholders) {
          const cap = equityAtLock.get(sh.memberId) ?? 0;
          if ((appliedCents.get(sh.memberId) ?? 0) > cap) {
            appliedCents.set(sh.memberId, cap);
          }
        }
      }

      // 5. Ledger: per-fund Dividend rows + per-shareholder equity rows.
      //    Both writes are grouped: N recipients cost 2 round-trips, not 2N.
      //    Reference numbers share one sequence (fund rows first, then member
      //    rows) so the idempotency dup-check (refBase-%) covers every leg.
      let appliedTotalCents = 0;
      const distributionsList: Array<{
        memberId: string;
        memberName: string;
        shares: number;
        requestedAmount: string;
        appliedAmount: string;
      }> = [];

      const recipients = shareholders
        .map((sh) => {
          const applied = appliedCents.get(sh.memberId) ?? 0;
          const beforeCents = equityAtLock.get(sh.memberId) ?? 0;
          return {
            sh,
            applied,
            beforeCents,
            afterCents: type === 'Profit' ? beforeCents + applied : beforeCents - applied,
          };
        })
        .filter((r) => r.applied > 0);

      // §12 loss mirror: the equity shareholders surrender must be written down
      // through the project fund, the linked fund and the project's expense
      // books by the same cents. Pre-validate sufficiency at the locked
      // balances BEFORE any ledger write.
      const lossTotalCents = type === 'Loss'
        ? recipients.reduce((acc, r) => acc + r.applied, 0)
        : 0;
      if (lossTotalCents > 0) {
        if (currentBalanceCents < lossTotalCents) {
          throw new ValidationError(
            `Insufficient project fund balance to absorb the loss (Available: ${fromCents(currentBalanceCents)}, Required: ${fromCents(lossTotalCents)})`,
          );
        }
        if (linkedFundBalanceCents < lossTotalCents) {
          throw new ValidationError(
            `Insufficient linked fund balance to absorb the loss (Available: ${fromCents(linkedFundBalanceCents)}, Required: ${fromCents(lossTotalCents)})`,
          );
        }
      }

      let refSeq = 0;
      const nextRef = () => `${refBase}-${(String(++refSeq)).padStart(2, '0')}`;

      // Per-fund Dividend ledger rows (Profit only), sorted by fund id.
      const fundLedgerRows: Array<typeof transactions.$inferInsert> = [];
      for (const [fid, payout] of [...fundPayoutCents.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const fund = fundById.get(fid);
        if (!fund) continue;
        const balBefore = toCents(fund.balance || '0');
        fundLedgerRows.push({
          tenantId,
          type: 'Dividend',
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

      if (recipients.length > 0) {
        // Grouped equity write-back under the row locks held above — the §6
        // tenant predicate stays in the WHERE.
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = v.balance::numeric,
              updated_at = ${now.toISOString()}::timestamptz
          FROM (VALUES ${sql.join(
            recipients.map((r) => sql`(${r.sh.memberId}::uuid, ${fromCents(r.afterCents)}::numeric)`),
            sql`, `,
          )}) AS v(id, balance)
          WHERE m.id = v.id AND m.tenant_id = ${tenantId}
        `);
      }

      const memberLedgerRows: Array<typeof transactions.$inferInsert> = recipients.map((r) => ({
        tenantId,
        type: type === 'Profit' ? 'Dividend' : 'Expense',
        amount: fromCents(r.applied),
        description: type === 'Profit'
          ? `Project profit return (${project.title}): ${description.trim()}`
          : `Project loss absorption (${project.title}): ${description.trim()}`,
        category: type === 'Profit' ? 'Profit Distribution' : 'Loss Allocation',
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
      }));

      if (fundLedgerRows.length > 0 || memberLedgerRows.length > 0) {
        await tx.insert(transactions).values([...fundLedgerRows, ...memberLedgerRows]);
      }

      for (const r of recipients) {
        appliedTotalCents += r.applied;
        distributionsList.push({
          memberId: r.sh.memberId,
          memberName: r.sh.memberName,
          shares: Number(r.sh.sharesInvested || 0),
          requestedAmount: fromCents(requestedCents.get(r.sh.memberId) ?? 0),
          appliedAmount: fromCents(r.applied),
        });
      }

      // 6. Fund books. The linked fund is the SOURCE: it is debited the full
      //    distribution; each recipient fund is credited its share. If the
      //    linked fund is also a recipient its net delta is (-full + share).
      //    Applied as one grouped UPDATE with relative deltas (row locks held,
      //    so f.balance + delta is exact with no clamping).
      const fundDeltaCents = new Map<string, number>();
      const linkedId = project.linkedFundId!;
      fundDeltaCents.set(linkedId, (fundDeltaCents.get(linkedId) ?? 0) - distributionAmountCents);
      for (const [fid, payout] of fundPayoutCents) {
        fundDeltaCents.set(fid, (fundDeltaCents.get(fid) ?? 0) + payout);
      }
      if (fundDeltaCents.size > 0) {
        await tx.execute(sql`
          UPDATE ${funds} AS f
          SET balance = (f.balance::numeric + v.delta::numeric(15,2)),
              updated_at = ${now.toISOString()}::timestamptz
          FROM (VALUES ${sql.join(
            [...fundDeltaCents.entries()].map(
              ([k, v]) => sql`(${k}::uuid, ${fromCents(v)}::numeric(15,2))`,
            ),
            sql`, `,
          )}) AS v(id, delta)
          WHERE f.id = v.id AND f.tenant_id = ${tenantId}
        `);
      }

      // Project books. Profit pays out of the project fund; Loss mirrors it.
      if (type === 'Profit') {
        const newBalanceStr = fromCents(currentBalanceCents - distributionAmountCents);
        await tx
          .update(projects)
          .set({
            currentFundBalance: newBalanceStr,
            updatedAt: now,
          })
          .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
      } else if (lossTotalCents > 0) {
        await tx
          .update(projects)
          .set({
            currentFundBalance: fromCents(currentBalanceCents - lossTotalCents),
            totalExpenses: fromCents(toCents(project.totalExpenses || '0') + lossTotalCents),
            updatedAt: now,
          })
          .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
      }

      const fundDistributionsList: Array<{
        fundId: string;
        fundName: string;
        percent: string;
        amount: string;
      }> = [...fundPayoutCents.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([fid, payout]) => ({
          fundId: fid,
          fundName: fundById.get(fid)?.name ?? '',
          percent: fromCents(fundPercentBp.get(fid) ?? 0),
          amount: fromCents(payout),
        }));

      return {
        type,
        requestedAmount: fromCents(distributionAmountCents),
        totalDistributed: fromCents(appliedTotalCents + fundsTotalCents),
        totalToMembers: fromCents(appliedTotalCents),
        totalToFunds: fromCents(fundsTotalCents),
        shareholderCount: distributionsList.length,
        fundCount: fundDistributionsList.length,
        distributions: distributionsList,
        fundDistributions: fundDistributionsList,
      };
    });

    const appliedTotalCents = toCents(distributionResult.totalToMembers);
    const fundsTotalCents = toCents(distributionResult.totalToFunds);
    const shortfallCents = distributionAmountCents - (appliedTotalCents + fundsTotalCents);
    const fundNote =
      distributionResult.fundCount > 0
        ? ` and ${distributionResult.fundCount} fund${distributionResult.fundCount > 1 ? 's' : ''}`
        : '';
    const message = type === 'Loss' && shortfallCents > 0
      ? `Project loss distribution applied ${distributionResult.totalDistributed} of ${distributionResult.requestedAmount} requested; some shareholders had insufficient equity to absorb their share`
      : `Project ${type.toLowerCase()} distribution executed successfully across ${distributionResult.shareholderCount} shareholder${distributionResult.shareholderCount === 1 ? '' : 's'}${fundNote}`;

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'DISTRIBUTE_PROJECT_RETURNS',
      resourceType: 'Project',
      resourceId: id,
      details: {
        type,
        amount: distributionResult.totalDistributed,
        requestedAmount: distributionResult.requestedAmount,
        totalToMembers: distributionResult.totalToMembers,
        totalToFunds: distributionResult.totalToFunds,
        shareholderCount: distributionResult.shareholderCount,
        fundCount: distributionResult.fundCount,
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
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to distribute project returns' },
      { status: e.statusCode || 500 },
    );
  }
}
