import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, funds, transactions, profitAllocations, fiscalPeriods } from '@/db/schema/index';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, AppError } from '@/lib/utils/errors';
import { MoneyError, fromCents, toCents } from '@/lib/money';
import { planDividendRun } from '@/server/modules/finance/dividend-engine';
import crypto from 'node:crypto';

// Batched run (grouped payout insert + one VALUES-joined equity update), but
// the full validation + run transaction still deserves timeout headroom.
export const maxDuration = 60;

/**
 * POST /api/dividends/distribute — execute a dividend run.
 *
 * The plan (reserve split, per-member payouts, run rate) comes from
 * `planDividendRun`, the same function the preview endpoint calls, so what an
 * operator approved is what gets paid.
 *
 * Concurrency: a run moves one fund's balance out to every member at once, so
 * the distributable fund, the reserve fund and every recipient row are locked
 * `FOR UPDATE` inside the transaction and the balance test is re-run against
 * the locked values. Without that, two simultaneous runs could each pass the
 * pre-check against a stale balance and overdraft the fund.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: dividend runs move money to every member — null tenant
    // must 403 so the fund/member/settings lookups below can never run global.
    const scopedTenantId = requireTenant(tenantId, user);

    if (!hasScreenPermission(user, 'DIVIDENDS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DIVIDENDS');
    }

    const body = await request.json();
    const {
      grossEarnings,
      distributableFundId,
      fiscalPeriodId,
      referenceNumber,
      statutoryReservePercent,
      reserveFundId,
    } = body;

    if (!grossEarnings || !distributableFundId) {
      throw new ValidationError('grossEarnings and distributableFundId are required');
    }
    if (typeof grossEarnings !== 'string' && typeof grossEarnings !== 'number') {
      throw new ValidationError('grossEarnings must be a number or numeric string');
    }

    const db = getDb();
    const refNumber =
      (typeof referenceNumber === 'string' && referenceNumber.trim()) ||
      `DIV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // Idempotency (§12): a retry with the same reference must not pay twice.
    const [alreadyRun] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.referenceNumber, refNumber),
          eq(transactions.isDeleted, false),
          eq(transactions.tenantId, scopedTenantId),
        ),
      )
      .limit(1);
    if (alreadyRun) {
      throw new ValidationError('A dividend run with this reference number already exists');
    }

    // Reads, validation and the exact split. Throws before any write if the
    // fund balance, reserve fund, member set or percent is unusable.
    const { plan, distributableFund, reserveFund } = await planDividendRun(scopedTenantId, {
      grossEarnings,
      distributableFundId: String(distributableFundId),
      statutoryReservePercent:
        statutoryReservePercent === undefined || statutoryReservePercent === null || statutoryReservePercent === ''
          ? null
          : String(statutoryReservePercent),
      reserveFundId: reserveFundId ? String(reserveFundId) : null,
    });

    const payoutRows = plan.payouts.filter((p) => p.payoutCents > 0);
    const currentYear = new Date().getFullYear();
    const now = new Date();

    await db.transaction(async (tx) => {
      // 1. Lock the two funds in deterministic id order (deadlock-safe), then
      // re-read their balances from inside the lock.
      const fundIds = [distributableFund.id, reserveFund.id].sort();
      for (const id of fundIds) {
        await tx.execute(
          sql`SELECT id FROM ${funds} WHERE id = ${id}::uuid AND tenant_id = ${scopedTenantId} FOR UPDATE`,
        );
      }
      const lockedFunds = await tx
        .select({ id: funds.id, name: funds.name, balance: funds.balance })
        .from(funds)
        .where(and(inArray(funds.id, fundIds), eq(funds.tenantId, scopedTenantId)));
      const lockedDistributable = lockedFunds.find((f) => f.id === distributableFund.id);
      const lockedReserve = lockedFunds.find((f) => f.id === reserveFund.id);
      if (!lockedDistributable || !lockedReserve) throw new AppError('Payout fund disappeared mid-run', 409, 'FUND_STALE');

      const distributableBeforeCents = toCents(lockedDistributable.balance ?? '0');
      const reserveBeforeCents = toCents(lockedReserve.balance ?? '0');
      if (distributableBeforeCents < plan.grossCents) {
        throw new ValidationError(
          `Insufficient fund balance. Available: ${fromCents(distributableBeforeCents)}, Required: ${plan.grossAmount}`,
        );
      }

      // 2. Lock every recipient row so the recorded member balances match the
      // equity actually updated below.
      if (payoutRows.length > 0) {
        await tx.execute(
          sql`SELECT id FROM ${members} WHERE id IN (${sql.join(
            payoutRows.map((p) => sql`${p.id}::uuid`),
            sql`, `,
          )}) AND tenant_id = ${scopedTenantId} FOR UPDATE`,
        );
      }
      const lockedMembers = payoutRows.length
        ? await tx
            .select({ id: members.id, totalContributed: members.totalContributed })
            .from(members)
            .where(and(inArray(members.id, payoutRows.map((p) => p.id)), eq(members.tenantId, scopedTenantId)))
        : [];
      const contributedById = new Map(lockedMembers.map((m) => [m.id, toCents(m.totalContributed ?? '0')]));

      const newDistributableCents = distributableBeforeCents - plan.grossCents;
      const newReserveCents = reserveBeforeCents + plan.reserveCents;

      // 3. Move the money. Both fund writes re-assert the tenant (§6).
      await tx
        .update(funds)
        .set({ balance: fromCents(newDistributableCents), updatedAt: now })
        .where(and(eq(funds.id, distributableFund.id), eq(funds.tenantId, scopedTenantId)));

      if (plan.reserveCents > 0) {
        await tx
          .update(funds)
          .set({ balance: fromCents(newReserveCents), updatedAt: now })
          .where(and(eq(funds.id, reserveFund.id), eq(funds.tenantId, scopedTenantId)));

        await tx.insert(transactions).values({
          tenantId: scopedTenantId,
          type: 'Statutory Reserve',
          amount: plan.reserveAmount,
          description: `Statutory reserve (${plan.reservePercent}%) for dividend run ${refNumber}`,
          category: 'Reserve',
          referenceNumber: `${refNumber}-RESERVE`,
          date: now,
          status: 'Completed',
          fundId: reserveFund.id,
          handlingOfficer: user.name,
          authorizedBy: user.id,
          balanceBefore: fromCents(reserveBeforeCents),
          balanceAfter: fromCents(newReserveCents),
          createdBy: user.id,
          updatedBy: user.id,
        });
      }

      // 4. The run-level distribution row.
      await tx.insert(transactions).values({
        tenantId: scopedTenantId,
        type: 'Dividend Distribution',
        amount: plan.netDistributable,
        description: `Dividend distribution to ${plan.recipientCount} members`,
        category: 'Dividend',
        referenceNumber: `${refNumber}-DIST`,
        date: now,
        status: 'Completed',
        fundId: distributableFund.id,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: fromCents(distributableBeforeCents),
        balanceAfter: fromCents(newDistributableCents),
        createdBy: user.id,
        updatedBy: user.id,
      });

      if (payoutRows.length > 0) {
        // 5a. One dividend row per recipient.
        await tx.insert(transactions).values(
          payoutRows.map((p) => {
            const beforeCents = contributedById.get(p.id) ?? 0;
            return {
              tenantId: scopedTenantId,
              type: 'Dividend',
              amount: p.grossAmount,
              description: `Dividend payout for ${p.shares} shares`,
              category: 'Dividend',
              referenceNumber: `${refNumber}-${p.memberId}`,
              date: now,
              status: 'Completed',
              memberId: p.id,
              fundId: distributableFund.id,
              handlingOfficer: user.name,
              authorizedBy: user.id,
              balanceBefore: fromCents(beforeCents),
              balanceAfter: fromCents(beforeCents + p.payoutCents),
              createdBy: user.id,
              updatedBy: user.id,
            };
          }),
        );

        // 5b. Add payouts to member equity in one grouped statement, computed
        // DB-side from the CURRENT total_contributed under the row locks held
        // above. The §6 tenant predicate stays in the WHERE — a VALUES join
        // must never widen the write scope.
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = (COALESCE(m.total_contributed, '0')::numeric + v.payout::numeric),
              last_active = ${now},
              updated_at = ${now}
          FROM (VALUES ${sql.join(
            payoutRows.map((p) => sql`(${p.id}::uuid, ${p.grossAmount}::numeric)`),
            sql`, `,
          )}) AS v(id, payout)
          WHERE m.id = v.id AND m.tenant_id = ${scopedTenantId}
        `);
      }

      // 6. Fiscal period: reuse an explicit id when given, else this tenant's
      // OPEN year, creating one only now that every check has passed — all
      // inside the run's transaction so a rollback cannot orphan a period.
      let fiscalPeriod: typeof fiscalPeriods.$inferSelect | null = null;
      const [lookup] = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          fiscalPeriodId
            ? and(eq(fiscalPeriods.id, String(fiscalPeriodId)), eq(fiscalPeriods.tenantId, scopedTenantId))
            : and(
                eq(fiscalPeriods.year, currentYear),
                eq(fiscalPeriods.status, 'OPEN'),
                eq(fiscalPeriods.tenantId, scopedTenantId),
              ),
        )
        .limit(1);
      fiscalPeriod = lookup ?? null;

      if (!fiscalPeriod && !fiscalPeriodId) {
        const [created] = await tx
          .insert(fiscalPeriods)
          .values({
            tenantId: scopedTenantId,
            year: currentYear,
            periodStart: new Date(`${currentYear}-01-01`),
            periodEnd: new Date(`${currentYear}-12-31`),
            status: 'OPEN',
          })
          .returning();
        fiscalPeriod = created ?? null;
      }

      if (fiscalPeriod) {
        // Rollups are additive and computed DB-side, so two runs in the same
        // year cannot clobber each other with stale read-then-write math.
        await tx.execute(sql`
          UPDATE ${fiscalPeriods}
          SET total_earnings = COALESCE(total_earnings, 0)::numeric + ${plan.grossAmount}::numeric,
              statutory_reserve = COALESCE(statutory_reserve, 0)::numeric + ${plan.reserveAmount}::numeric,
              distributable_surplus = COALESCE(distributable_surplus, 0)::numeric + ${plan.netDistributable}::numeric,
              actual_distributed = COALESCE(actual_distributed, 0)::numeric + ${plan.netDistributable}::numeric,
              updated_at = ${now}
          WHERE id = ${fiscalPeriod.id} AND tenant_id = ${scopedTenantId}
        `);
      }

      // 7. Profit allocation per recipient, recording the rate that produced
      // the payout — the member directory reads this as the expected dividend.
      if (payoutRows.length > 0) {
        await tx.insert(profitAllocations).values(
          payoutRows.map((p) => ({
            tenantId: scopedTenantId,
            fiscalPeriodId: fiscalPeriod?.id,
            memberId: p.id,
            allocationType: 'Dividend',
            amount: p.grossAmount,
            sharesAtTime: p.shares,
            ratePerShare: p.ratePerShare,
            notes: `Dividend run ${refNumber}`,
            allocatedBy: user.id,
            allocatedAt: now,
          })),
        );
      }
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: scopedTenantId,
      action: 'DISTRIBUTE_DIVIDEND',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        grossEarnings: plan.grossAmount,
        statutoryReservePercent: plan.reservePercent,
        statutoryReserveAmount: plan.reserveAmount,
        netDistributable: plan.netDistributable,
        totalActiveShares: plan.totalActiveShares,
        ratePerShare: plan.ratePerShare,
        memberCount: plan.recipientCount,
        distributableFund: { id: distributableFund.id, name: distributableFund.name },
        reserveFund: { id: reserveFund.id, name: reserveFund.name },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        grossEarnings: plan.grossAmount,
        statutoryReservePercent: plan.reservePercent,
        statutoryReserveAmount: plan.reserveAmount,
        netDistributable: plan.netDistributable,
        totalActiveShares: plan.totalActiveShares,
        ratePerShare: plan.ratePerShare,
        memberCount: plan.recipientCount,
        totalDistributed: fromCents(plan.totalDistributedCents),
        distributableFund: { id: distributableFund.id, name: distributableFund.name },
        reserveFund: { id: reserveFund.id, name: reserveFund.name },
      },
      message: 'Dividend distribution completed successfully',
    });
  } catch (err: unknown) {
    console.error('[DIVIDEND DISTRIBUTE ERROR]', err);
    if (err instanceof MoneyError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code }, { status: 400 });
    }
    const e = err as { statusCode?: number; message?: string };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to distribute dividend' },
      { status: e.statusCode || 500 },
    );
  }
}
