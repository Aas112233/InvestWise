import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, members, funds, transactions } from '@/db/schema/index';
import { eq, and, inArray, or, like, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { projectReturnDistributionSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from '../../_helpers';
import { parsePositiveAmount, splitDividendByShares, toCents, fromCents } from '@/lib/money';
import crypto from 'node:crypto';

// The run locks the project + every recipient row and writes grouped ledger
// rows — keep headroom over the 10s serverless default for large co-ops.
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
    const body = await request.json();
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

      const totalShares = Number(project.totalShares || 0);
      if (totalShares <= 0) {
        throw new ValidationError('Project has zero total shares; cannot distribute returns');
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

      // 2. Fetch project shareholders (deterministic order)
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

      if (shareholders.length === 0) {
        throw new ValidationError('No active shareholders found in this project');
      }

      // Lock member rows in deterministic order: the equity snapshots feed the
      // ledger balanceBefore/After and cap loss absorption.
      const shareholderIds = shareholders.map((s) => s.memberId).sort();
      const lockedMembers = await tx
        .select({ id: members.id, equity: members.totalContributed })
        .from(members)
        .where(and(inArray(members.id, shareholderIds), eq(members.tenantId, tenantId)))
        .orderBy(members.id)
        .for('update');
      const equityAtLock = new Map<string, number>();
      for (const m of lockedMembers) {
        equityAtLock.set(m.id, toCents(m.equity ?? '0'));
      }
      const remainingEquity = new Map(equityAtLock);

      const currentBalanceCents = toCents(project.currentFundBalance || '0');

      if (type === 'Profit' && currentBalanceCents < distributionAmountCents) {
        throw new ValidationError(
          `Insufficient project fund balance for profit payout (Available: ${fromCents(currentBalanceCents)}, Required: ${fromCents(distributionAmountCents)})`,
        );
      }

      const now = new Date();

      // 3. Pro-rata split by shares in exact cents (deterministic
      //    largest-remainder; sum(payouts) === requested total).
      let split: Array<{ id: string; shares: number; payoutCents: number }>;
      try {
        split = splitDividendByShares(
          distributionAmountCents,
          shareholders.map((s) => ({ id: s.memberId, shares: Number(s.sharesInvested || 0) })),
        );
      } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : 'Cannot split distribution across shareholders');
      }
      const requestedCents = new Map(split.map((s) => [s.id, s.payoutCents]));
      const appliedCents = new Map(requestedCents);

      // 4. Loss: a debit can never exceed the member's recorded equity. Clamp
      //    each over-cap debit and re-allocate the shortfall to shareholders
      //    with remaining equity. Every pass fully consumes at least one
      //    member's equity, so the loop is bounded; the final clamp after the
      //    loop guarantees the invariant unconditionally.
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

      // 5. Ledger: per-shareholder equity update + audit-grade transaction row.
      //    Members with nothing applied (no shares / equity exhausted) post no
      //    rows. Both writes are grouped: N recipients cost 2 round-trips, not 2N.
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

      if (recipients.length > 0) {
        // Grouped equity write-back under the row locks held above — the §6
        // tenant predicate stays in the WHERE.
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = v.balance::numeric,
              updated_at = ${now}
          FROM (VALUES ${sql.join(
            recipients.map((r) => sql`(${r.sh.memberId}::uuid, ${fromCents(r.afterCents)}::numeric)`),
            sql`, `,
          )}) AS v(id, balance)
          WHERE m.id = v.id AND m.tenant_id = ${tenantId}
        `);

        await tx.insert(transactions).values(
          recipients.map((r, idx) => ({
            tenantId,
            type: type === 'Profit' ? 'Dividend' : 'Expense',
            amount: fromCents(r.applied),
            description: type === 'Profit'
              ? `Project profit return (${project.title}): ${description.trim()}`
              : `Project loss absorption (${project.title}): ${description.trim()}`,
            category: type === 'Profit' ? 'Profit Distribution' : 'Loss Allocation',
            referenceNumber: `${refBase}-${(idx + 1).toString().padStart(2, '0')}`,
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
          })),
        );

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
      }

      // 6. Update project balance if Profit payout was disbursed
      if (type === 'Profit') {
        const newBalanceStr = fromCents(currentBalanceCents - distributionAmountCents);
        await tx
          .update(projects)
          .set({
            currentFundBalance: newBalanceStr,
            updatedAt: now,
          })
          .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));

        if (project.linkedFundId) {
          await tx
            .update(funds)
            .set({
              balance: sql<string>`GREATEST(0, (${funds.balance}::numeric - ${fromCents(distributionAmountCents)}::numeric))::numeric(15,2)`,
              updatedAt: now,
            })
            .where(and(eq(funds.id, project.linkedFundId), eq(funds.tenantId, tenantId)));
        }
      }

      return {
        type,
        requestedAmount: fromCents(distributionAmountCents),
        totalDistributed: fromCents(appliedTotalCents),
        shareholderCount: distributionsList.length,
        distributions: distributionsList,
      };
    });

    const appliedTotalCents = toCents(distributionResult.totalDistributed);
    const shortfallCents = distributionAmountCents - appliedTotalCents;
    const message = type === 'Loss' && shortfallCents > 0
      ? `Project loss distribution applied ${distributionResult.totalDistributed} of ${distributionResult.requestedAmount} requested; some shareholders had insufficient equity to absorb their share`
      : `Project ${type.toLowerCase()} distribution executed successfully across ${distributionResult.shareholderCount} shareholders`;

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'DISTRIBUTE_PROJECT_RETURNS',
      resourceType: 'Project',
      resourceId: id,
      details: {
        type,
        amount: distributionResult.totalDistributed,
        requestedAmount: distributionResult.requestedAmount,
        shareholderCount: distributionResult.shareholderCount,
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
