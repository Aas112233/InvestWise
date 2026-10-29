import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, funds, transactions, profitAllocations, fiscalPeriods, systemSettings } from '@/db/schema/index';
import { eq, and, sql, inArray, gte, lte } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, AppError, LockedError, readJsonBody } from '@/lib/utils/errors';
import { MoneyError, fromCents, toCents } from '@/lib/money';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { fiscalStartYearForDate, resolveFiscalBounds } from '@/lib/fiscal-periods';
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

    const body = await readJsonBody(request);
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
    //
    // This route never writes the BARE reference — it writes three suffixed
    // forms per run: `${refNumber}-RESERVE`, `${refNumber}-DIST`, and
    // `${refNumber}-${memberId}`. So the guard must match on the suffix family,
    // not on equality with refNumber (which would never match anything and let
    // a retry through). LIKE is literal here because refNumber is a generated
    // identifier; its `_` and `%`-free shape is asserted below so a caller
    // cannot smuggle a wildcard into the pattern.
    if (refNumber.includes('%') || refNumber.includes('_')) {
      // Escape rather than reject would change the stored reference; rejecting
      // keeps the reference family well-formed for every downstream consumer.
      throw new ValidationError('Reference number may not contain "%" or "_"');
    }
    const alreadyRun = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, scopedTenantId),
          eq(transactions.isDeleted, false),
          sql`(${transactions.referenceNumber} = ${refNumber}
                OR ${transactions.referenceNumber} LIKE ${refNumber + '-%'})`,
        ),
      )
      .limit(1);
    if (alreadyRun.length > 0) {
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
    const now = new Date();
    const [fiscalSettings] = await db
      .select({ fiscalYearStart: systemSettings.fiscalYearStart, fiscalYearEnd: systemSettings.fiscalYearEnd })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, scopedTenantId))
      .limit(1);
    const fiscalYearStart = fiscalSettings?.fiscalYearStart || 'July';
    const fiscalYearEnd = fiscalSettings?.fiscalYearEnd || 'June';
    const currentYear = fiscalStartYearForDate(now, fiscalYearStart);
    let fiscalBounds;
    try {
      fiscalBounds = resolveFiscalBounds(currentYear, fiscalYearStart, fiscalYearEnd);
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }

    await db.transaction(async (tx) => {
      await assertFiscalPeriodOpen(tx, scopedTenantId, now);
      // Raw `sql` fragments bind dates via Buffer.from(), which rejects Date
      // instances — every timestamp interpolated into a raw fragment below
      // must be an ISO string (this was the distribute 500).
      const nowIso = now.toISOString();
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

        // #97: the payout fund is debited by the GROSS (reserve + distributed),
        // but until now the reserve half of that debit had no row against it —
        // the only rows on this fund were the per-member dividends. Every fund
        // statement (and the report's running balance) therefore ended the run
        // `reserveAmount` above the cash the fund actually held, while the
        // reserve fund showed the sweep and no matching outflow existed. Post
        // the outflow leg so each fund's ledger reconstructs its own balance.
        await tx.insert(transactions).values({
          tenantId: scopedTenantId,
          type: 'Transfer Out',
          amount: plan.reserveAmount,
          description: `Statutory reserve sweep to ${reserveFund.name} (${plan.reservePercent}%) for dividend run ${refNumber}`,
          category: 'Reserve',
          referenceNumber: `${refNumber}-RESERVE-OUT`,
          date: now,
          status: 'Completed',
          fundId: distributableFund.id,
          handlingOfficer: user.name,
          authorizedBy: user.id,
          balanceBefore: fromCents(distributableBeforeCents),
          balanceAfter: fromCents(distributableBeforeCents - plan.reserveCents),
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
        //
        // `now` is passed as an ISO STRING, not a Date: this is a raw `sql`
        // fragment, and postgres-js binds it via Buffer.from(), which throws
        // ERR_INVALID_ARG_TYPE on a Date instance — that was the real cause of
        // the distribute 500 (the whole run rolled back with no feedback).
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = (COALESCE(m.total_contributed, '0')::numeric + v.payout::numeric),
              last_active = ${nowIso}::timestamptz,
              updated_at = ${nowIso}::timestamptz
          FROM (VALUES ${sql.join(
            payoutRows.map((p) => sql`(${p.id}::uuid, ${p.grossAmount}::numeric)`),
            sql`, `,
          )}) AS v(id, payout)
          WHERE m.id = v.id AND m.tenant_id = ${scopedTenantId}
        `);
      }

      // 6. Fiscal period: resolve by the actual transaction date (not just a
      // calendar year), creating a configured period only after all checks pass.
      let fiscalPeriod: typeof fiscalPeriods.$inferSelect | null = null;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopedTenantId}), ${currentYear})`);
      const [lookup] = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          fiscalPeriodId
            ? and(eq(fiscalPeriods.id, String(fiscalPeriodId)), eq(fiscalPeriods.tenantId, scopedTenantId))
            : and(
                eq(fiscalPeriods.status, 'OPEN'),
                eq(fiscalPeriods.tenantId, scopedTenantId),
                lte(fiscalPeriods.periodStart, now),
                gte(fiscalPeriods.periodEnd, now),
              ),
        )
        .for('update')
        .limit(1);
      fiscalPeriod = lookup ?? null;

      if (fiscalPeriodId && !fiscalPeriod) throw new ValidationError('Fiscal period not found for this tenant');
      if (fiscalPeriod?.status === 'CLOSED') throw new LockedError('Dividend payouts cannot be allocated to a closed fiscal period. Choose a fiscal period that is still open.');
      if (
        fiscalPeriodId &&
        fiscalPeriod &&
        (fiscalPeriod.periodStart > now || fiscalPeriod.periodEnd < now)
      ) {
        throw new ValidationError('The selected fiscal period does not contain the dividend transaction date');
      }

      if (!fiscalPeriod && !fiscalPeriodId) {
        const [created] = await tx
          .insert(fiscalPeriods)
          .values({
            tenantId: scopedTenantId,
            year: currentYear,
            periodStart: fiscalBounds.periodStart,
            periodEnd: fiscalBounds.periodEnd,
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
              updated_at = ${nowIso}::timestamptz
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
    return apiError(e, 'Failed to distribute dividend');
  }
}
