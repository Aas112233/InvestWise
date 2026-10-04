import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { members, projects, funds, transactions, auditLogs } from '@/db/schema/index';
import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { AnalyticsStats } from '@/types';

/** First day of the month 11 months ago (UTC) — window for the 12-bucket deposit series. */
const DEPOSITS_WINDOW = sql`date_trunc('month', now()) - interval '11 months'`;
/** Start of the 3-calendar-month expense window used for the burn-rate (2 full months + current). */
const EXPENSE_WINDOW = sql`date_trunc('month', now()) - interval '2 months'`;

/** 'YYYY-MM' key for a UTC date, used to align DB month buckets with the client series. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: dashboard aggregates + recent audit trail — null tenant
    // must 403 instead of summing every tenant's money.
    const scopedTenantId = requireTenant(tenantId, user);

    const db = getDb();

    // Tenant scoped conditions (unconditional — scopedTenantId 403s on null).
    const memberCond = eq(members.tenantId, scopedTenantId);
    const projectCond = and(eq(projects.status, 'In Progress'), eq(projects.tenantId, scopedTenantId));
    const fundCond = and(eq(funds.status, 'ACTIVE'), eq(funds.tenantId, scopedTenantId));
    const depositCond = and(eq(transactions.type, 'Deposit'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
    const dividendCond = and(eq(transactions.type, 'Dividend'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
    const expenseCond = and(eq(transactions.type, 'Expense'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
    const tenantProjectCond = eq(projects.tenantId, scopedTenantId);

    // Parallel aggregate queries — one round-trip batch (Tokyo pooler RT dominates).
    const [
      memberAgg,
      projectAgg,
      fundAgg,
      txDepositAgg,
      txDividendAgg,
      investmentAgg,
      monthlyDepositRows,
      ongoingProjectRows,
      expenseRunRateAgg,
      recentLogs,
    ] = await withDbRetry(() => Promise.all([
      db
        .select({
          totalMembers: sql<number>`count(*)::int`,
          activeMembers: sql<number>`count(*) filter (where ${members.status} = 'active')::int`,
          totalContributed: sql<number>`coalesce(sum(${members.totalContributed}::numeric), 0)::float`,
          // Founding vs normal split (members.role — 'Founding Member' is the
          // canonical founding category, everything else groups as normal).
          foundingShares: sql<number>`coalesce(sum(${members.shares}) filter (where ${members.role} = 'Founding Member'), 0)::int`,
          normalShares: sql<number>`coalesce(sum(${members.shares}) filter (where coalesce(${members.role}, 'Member') <> 'Founding Member'), 0)::int`,
          foundingMembers: sql<number>`count(*) filter (where ${members.role} = 'Founding Member')::int`,
          normalMembers: sql<number>`count(*) filter (where coalesce(${members.role}, 'Member') <> 'Founding Member')::int`,
        })
        .from(members)
        .where(memberCond),
      db
        .select({
          activeProjects: sql<number>`count(*)::int`,
          ongoingBudget: sql<number>`coalesce(sum(${projects.budget}::numeric), 0)::float`,
          totalExpenses: sql<number>`coalesce(sum(${projects.totalExpenses}::numeric), 0)::float`,
        })
        .from(projects)
        .where(projectCond),
      db
        .select({
          netReserves: sql<number>`coalesce(sum(${funds.balance}::numeric), 0)::float`,
        })
        .from(funds)
        .where(fundCond),
      db
        .select({
          totalDeposits: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
          depositCount: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .where(depositCond),
      db
        .select({
          totalDividends: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
        })
        .from(transactions)
        .where(dividendCond),
      db
        .select({
          investmentsTotal: sql<number>`coalesce(sum(${projects.initialInvestment}::numeric), 0)::float`,
          investmentsCount: sql<number>`count(*)::int`,
        })
        .from(projects)
        .where(tenantProjectCond),
      // 12-month deposit series: amount, entry count, distinct submitting members.
      db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
          amount: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
          count: sql<number>`count(*)::int`,
          submittingMembers: sql<number>`count(distinct ${transactions.memberId})::int`,
        })
        .from(transactions)
        .where(and(
          depositCond,
          eq(transactions.status, 'Completed'),
          gte(transactions.date, DEPOSITS_WINDOW),
        ))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      // Ongoing projects: earnings vs expenses (maintained aggregates).
      db
        .select({
          id: projects.id,
          title: projects.title,
          income: sql<number>`coalesce(${projects.totalEarnings}::numeric, 0)::float`,
          expenses: sql<number>`coalesce(${projects.totalExpenses}::numeric, 0)::float`,
        })
        .from(projects)
        .where(projectCond)
        .orderBy(desc(projects.budget))
        .limit(12),
      // Expenses over the last 3 calendar months (incl. current partial) → monthly burn.
      db
        .select({
          recentExpenses: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
        })
        .from(transactions)
        .where(and(expenseCond, gte(transactions.date, EXPENSE_WINDOW))),
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, scopedTenantId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(5),
    ]));

    const totalContributed = memberAgg[0]?.totalContributed ?? 0;
    const netReserves = fundAgg[0]?.netReserves ?? 0;
    // Total assets is the total treasury held across active funds (netReserves).
    // Member contributions represent member equity, not an additive asset.
    const totalAssets = netReserves;
    const activeProjects = projectAgg[0]?.activeProjects ?? 0;
    const ongoingBudget = projectAgg[0]?.ongoingBudget ?? 0;
    const totalMembers = memberAgg[0]?.totalMembers ?? 0;
    const activeMembers = memberAgg[0]?.activeMembers ?? 0;
    const foundingShares = memberAgg[0]?.foundingShares ?? 0;
    const normalShares = memberAgg[0]?.normalShares ?? 0;
    const foundingMembers = memberAgg[0]?.foundingMembers ?? 0;
    const normalMembers = memberAgg[0]?.normalMembers ?? 0;
    const totalExpenses = projectAgg[0]?.totalExpenses ?? 0;
    const totalDeposits = txDepositAgg[0]?.totalDeposits ?? 0;
    const depositCount = txDepositAgg[0]?.depositCount ?? 0;
    const totalDividendsDistributed = txDividendAgg[0]?.totalDividends ?? 0;
    const investmentsTotal = investmentAgg[0]?.investmentsTotal ?? 0;
    const investmentsCount = investmentAgg[0]?.investmentsCount ?? 0;

    // Fill 12 month buckets (oldest → current) so gaps render as zeros, and
    // derive the submission rate: share of active members who deposited that month.
    const byMonth = new Map((monthlyDepositRows || []).map((r) => [r.month, r]));
    const now = new Date();
    const monthlyDeposits = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
      const key = monthKey(d);
      const row = byMonth.get(key);
      const submittingMembers = row?.submittingMembers ?? 0;
      return {
        month: key,
        amount: row?.amount ?? 0,
        count: row?.count ?? 0,
        submittingMembers,
        submissionRate: activeMembers > 0 ? Math.round((submittingMembers / activeMembers) * 1000) / 10 : null,
      };
    });

    // Funds health: runway = reserves ÷ average monthly expenses (3-month window ÷ 3).
    const recentExpenses = expenseRunRateAgg[0]?.recentExpenses ?? 0;
    const monthlyBurn = Math.round((recentExpenses / 3) * 100) / 100;
    const runwayMonths = monthlyBurn > 0 ? Math.round((netReserves / monthlyBurn) * 10) / 10 : null;
    const fundsHealthStatus: AnalyticsStats['fundsHealth']['status'] =
      monthlyBurn > 0 && netReserves <= 0 ? 'Critical'
      : runwayMonths === null ? 'Good' // nothing burning; reserves intact
      : runwayMonths >= 12 ? 'Good'
      : runwayMonths >= 6 ? 'Stable'
      : runwayMonths >= 3 ? 'At Risk'
      : 'Critical';

    const recentActivities = (recentLogs || []).map((log) => ({
      id: log.id,
      type: log.resourceType || 'System',
      description: log.action.replace(/_/g, ' '),
      timestamp: log.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
    }));

    // Real aggregates only — an empty tenant shows zeros, never demo numbers
    // (AGENTS.md §0/§12: this system moves real money).
    const stats: AnalyticsStats = {
      totalAssets,
      totalMembers,
      activeMembers,
      activeProjects,
      ongoingBudget,
      totalDividendsDistributed,
      // No historical period data exists to compute growth from — report
      // "unknown" instead of inventing a percentage. Wire this to a real
      // period-over-period calculation when a snapshot table lands.
      monthlyGrowthRate: null,
      totalDeposits,
      depositCount,
      totalExpenses,
      netReserveBalance: netReserves,
      totalShares: foundingShares + normalShares,
      foundingShares,
      normalShares,
      foundingMembers,
      normalMembers,
      investmentsTotal,
      investmentsCount,
      monthlyDeposits,
      ongoingProjectFinance: ongoingProjectRows || [],
      fundsHealth: {
        reserves: netReserves,
        monthlyBurn,
        runwayMonths,
        status: fundsHealthStatus,
      },
      recentActivities,
    };

    return NextResponse.json(stats);
  } catch (err: any) {
    console.error('[ANALYTICS STATS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to aggregate analytics' },
      { status: err.statusCode || 500 }
    );
  }
}
