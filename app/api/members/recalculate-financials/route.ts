import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, transactions } from '@/db/schema/index';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getAuthContext, requirePermission } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { guard } from '@/lib/guarded-route';
import { SETTLED_DEPOSIT_STATUSES } from '@/lib/ledger-selectors';
import { logAudit } from '@/lib/utils/audit';
import { toCents, fromCents } from '@/lib/money';
import { ForbiddenError } from '@/lib/utils/errors';
import { normalizeRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * POST /api/members/recalculate-financials — Admin-only reconciliation
 * utility (ports the Express route that never reached Next). It repairs what
 * is DETERMINISTIC from the ledger and reports the rest honestly:
 *
 *  - lastDepositMonth: recomputed as the latest completed, non-deleted deposit
 *    month. Fully derived from the ledger, so it is written back. This fixes
 *    the "stored month lags after a reversal/correction" drift.
 *  - totalContributed (member EQUITY): NOT auto-rewritten. Equity is deposits
 *    + reinvested dividends − withdrawals, adjusted by equity transfers — but
 *    the ledger stores both legs of an Equity-Transfer with the same positive
 *    amount and only the memberId distinguishes give from take, so a row's
 *    sign is not reconstructable from the ledger alone. Rewriting it from a
 *    guessed sign would corrupt real money. Instead this returns a drift list
 *    so an operator can review the specific rows.
 *
 * ponytail: make totalContributed fully derivable by adding an explicit
 * direction (+/-) column (or signed amounts) to transactions on equity
 * transfers; then this can reconcile it too. Money change, not a display
 * change — deferred deliberately.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // Financial reconciliation is a governance action: the Express reference
    // gated it on `admin`, not the broad MEMBERS WRITE. Same here.
    if (normalizeRole(user.role) !== 'Admin') {
      throw new ForbiddenError('Admin access required to recalculate member financials');
    }
    // Belt-and-braces permission read for non-SuperAdmin tenant Admins.
    requirePermission('MEMBERS', 'WRITE')(user);
    const tenantId = requireTenant(user.tenantId, user);

    // Three unbounded full-tenant aggregates plus an UPDATE whose VALUES list
    // grows with the number of drifted members, and no maxDuration declared —
    // so a second concurrent call does not just cost more, it dies mid-write.
    const limited = await guard(request, 'recompute', { user: user.id, tenant: tenantId });
    if (limited) return limited;

    const db = getDb();

    // The three reference reads are independent of each other (all keyed off
    // the tenant alone) — one round-trip group instead of three serial ones.
    // On the Tokyo pooler each round-trip costs ~250ms, so this saves ~500ms
    // per reconciliation.
    const [monthRows, creditRows, liveMembers] = await Promise.all([
      // Latest completed deposit month per member, from the ledger (stored
      // deposit_month first; collected-date month only for legacy rows without
      // one). Mirrors the directory's derived lastDepositMonthExpr exactly.
      db
        .select({
          memberId: transactions.memberId,
          lastMonth: sql<string>`MAX(COALESCE(${transactions.depositMonth}, TO_CHAR(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM')))`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, tenantId),
            eq(transactions.type, 'Deposit'),
            // #101: the shared settled set, not 'Completed' alone — every other
            // aggregate treats 'Success' as money that landed, and a
            // reconciliation that ignores it reports a deposit month the member
            // demonstrably has.
            inArray(transactions.status, SETTLED_DEPOSIT_STATUSES),
            eq(transactions.isDeleted, false),
            sql`${transactions.memberId} IS NOT NULL`,
          ),
        )
        .groupBy(transactions.memberId),
      // Credits-only equity reference (deposits + dividends) — used only for
      // the drift report, never written. Deposits/dividends are always positive
      // and carry an unambiguous sign, unlike equity transfers/withdrawals.
      db
        .select({
          memberId: transactions.memberId,
          credits: sql<string>`ROUND(COALESCE(SUM(${transactions.amount}::numeric), 0), 2)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, tenantId),
            inArray(transactions.status, SETTLED_DEPOSIT_STATUSES),
            eq(transactions.isDeleted, false),
            sql`${transactions.type} IN ('Deposit', 'Dividend')`,
            sql`${transactions.memberId} IS NOT NULL`,
          ),
        )
        .groupBy(transactions.memberId),
      db
        .select({
          id: members.id,
          memberId: members.memberId,
          name: members.name,
          totalContributed: members.totalContributed,
          lastDepositMonth: members.lastDepositMonth,
        })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), eq(members.isDeleted, false))),
    ]);

    const monthByMember = new Map(monthRows.map((r) => [r.memberId as string, r.lastMonth]));
    const creditsByMember = new Map(creditRows.map((r) => [r.memberId as string, r.credits]));

    // Collect the corrected months and write them in ONE grouped UPDATE
    // (UPDATE ... FROM (VALUES ...)) instead of one UPDATE per drifted member —
    // N round-trips become 1. Skips the write entirely when nothing drifted.
    const monthUpdates = liveMembers
      .map((m) => ({ id: m.id, stored: m.lastDepositMonth ?? null, derived: monthByMember.get(m.id) ?? null }))
      .filter((row) => row.stored !== row.derived);
    const monthsCorrected = monthUpdates.length;

    if (monthUpdates.length > 0) {
      const values = sql.join(
        monthUpdates.map((u) => sql`(${u.id}::uuid, ${u.derived})`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE ${members} AS m
        SET last_deposit_month = v.derived,
            updated_at = NOW()
        FROM (VALUES ${values}) AS v(id, derived)
        WHERE m.id = v.id AND m.tenant_id = ${tenantId}
      `);
    }

    const equityDrift: Array<{
      memberId: string;
      name: string;
      storedEquity: string;
      ledgerCredits: string;
      difference: string;
      note: string;
    }> = [];

    for (const m of liveMembers) {
      const credits = creditsByMember.get(m.id) ?? '0.00';
      const storedCents = toCents(m.totalContributed ?? '0.00');
      const creditsCents = toCents(credits);
      if (storedCents !== creditsCents) {
        equityDrift.push({
          memberId: m.memberId,
          name: m.name,
          storedEquity: fromCents(storedCents),
          ledgerCredits: fromCents(creditsCents),
          difference: fromCents(storedCents - creditsCents),
          note:
            'Difference from deposit+dividend credits. A non-zero value is expected if this member had withdrawals or equity transfers — those are not reconciled automatically.',
        });
      }
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'RECALCULATE_MEMBER_FINANCIALS',
      resourceType: 'Member',
      details: { monthsCorrected, equityDriftCount: equityDrift.length },
      status: 'SUCCESS',
    });

    return NextResponse.json({
      success: true,
      data: { scanned: liveMembers.length, monthsCorrected, equityDrift },
      message: `Recalculated ${liveMembers.length} members — ${monthsCorrected} deposit-month ${
        monthsCorrected === 1 ? 'value' : 'values'
      } corrected, ${equityDrift.length} equity ${
        equityDrift.length === 1 ? 'row needs review' : 'rows need review'
      }.`,
    });
  } catch (err: unknown) {
    console.error('[RECALCULATE MEMBER FINANCIALS ERROR]', err);
    const e = err as { statusCode?: number; message?: string; code?: string };
    return apiError(e, 'Recalculation failed');
  }
}
