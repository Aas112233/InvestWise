import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { members, projects, funds, transactions, auditLogs, systemSettings } from '@/db/schema/index';
import { eq, and, sql, desc, gte, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { SETTLED_DEPOSIT_STATUSES } from '@/lib/ledger-selectors';
import { fiscalMonthSequence, fiscalStartYearForDate } from '@/lib/fiscal-periods';
import { AnalyticsStats } from '@/types';

/**
 * Window for the deposit series: a rolling 11-month floor. The series is
 * fiscal-year aligned (see `monthlyDeposits` below), so the query window must
 * be wide enough to cover a fiscal year that began up to 11 months ago —
 * otherwise the earliest buckets would silently read as zero.
 */
const DEPOSITS_WINDOW = sql`date_trunc('month', now()) - interval '11 months'`;
/** Start of the 3-calendar-month expense window used for the burn-rate (2 full months + current). */
const EXPENSE_WINDOW = sql`date_trunc('month', now()) - interval '2 months'`;
/** Start of the CURRENT calendar month — the headline "Monthly Burn" window. */
const CURRENT_MONTH_WINDOW = sql`date_trunc('month', now())`;

/**
 * 'YYYY-MM' key for a fiscal-year slot. `FiscalMonth.index` is the 0-based
 * CALENDAR month, so a slot whose calendar month precedes the fiscal start
 * (index < startIndex) rolls into the following calendar year.
 */
function fiscalMonthKey(fiscalStartYear: number, fm: { index: number }, startIndex: number): string {
  const calendarYear = fiscalStartYear + (fm.index < startIndex ? 1 : 0);
  return `${calendarYear}-${String(fm.index + 1).padStart(2, '0')}`;
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
    // Members are soft-deleted (members.isDeleted), and every other member
    // read filters them out. Without the isDeleted predicate `totalMembers`
    // counted deleted rows and `activeMembers` could count a soft-deleted
    // member still carrying status='active' — inflating the dashboard
    // headcount above the members list right next to it.
    const memberCond = and(eq(members.tenantId, scopedTenantId), eq(members.isDeleted, false));
    const projectCond = and(eq(projects.status, 'In Progress'), eq(projects.tenantId, scopedTenantId));
    const fundCond = and(eq(funds.status, 'ACTIVE'), eq(funds.tenantId, scopedTenantId));
    const depositCond = and(
      eq(transactions.type, 'Deposit'),
      eq(transactions.isDeleted, false),
      eq(transactions.tenantId, scopedTenantId),
      // Settled only. Without this the headline "Total Deposits" counted
      // PENDING requests and REJECTED slips as collected cash (report issue
      // 27) — the same screen then showed a different number for "money we
      // have" than the fund balance right beside it.
      inArray(transactions.status, SETTLED_DEPOSIT_STATUSES),
    );
    const dividendCond = and(eq(transactions.type, 'Dividend'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
    const expenseCond = and(eq(transactions.type, 'Expense'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
    // Income is the mirror of the Expenses KPI: the all-time Earning ledger
    // (project revenue booked via the project disbursement flow), not
    // projects.totalEarnings — which excludes income earned outside a project.
    const incomeCond = and(eq(transactions.type, 'Earning'), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId));
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
      currentMonthExpenseAgg,
      expenseLedgerAgg,
      incomeLedgerAgg,
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
      // "Total Investments" = money ACTUALLY invested, not planned. The
      // `currentFundBalance` is the live project-fund balance: shareholder
      // capital credited at creation + posted earnings − expenses − return
      // distributions. `initialInvestment`/`budget` are planning fields that
      // are never posted to the books, so summing them overstated the KPI.
      db
        .select({
          investmentsTotal: sql<number>`coalesce(sum(${projects.currentFundBalance}::numeric), 0)::float`,
          investmentsCount: sql<number>`count(*)::int`,
        })
        .from(projects)
        .where(tenantProjectCond),
      // 12-month deposit series: amount, entry count, distinct submitting members.
      //
      // Bucket by the deposit's OWN `deposit_month` (which month this money
      // covers), not the transaction date it was recorded — matching how
      // governance/compliance reads `lastDepositMonth`. A January contribution
      // entered in October belongs in the January slot. Legacy rows without a
      // deposit_month (or with a malformed one) fall back to the transaction
      // date so no data is silently dropped.
      db
        .select({
          month: sql<string>`(
            case
              when ${transactions.depositMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
                then ${transactions.depositMonth}
              else to_char(${transactions.date}, 'YYYY-MM')
            end
          )`,
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
      // Current calendar month expenses — the headline burn number.
      db
        .select({
          currentMonthExpenses: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
        })
        .from(transactions)
        .where(and(expenseCond, gte(transactions.date, CURRENT_MONTH_WINDOW))),
      // All-time expense ledger total — the Dashboard "Expenses" KPI. This must
      // be the Expense TRANSACTIONS, not projects.totalExpenses: standalone
      // operating costs (office rent, utilities) belong to no project, so the
      // project aggregate reported 0 and the KPI was stuck at zero.
      db
        .select({
          totalExpenseLedger: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
        })
        .from(transactions)
        .where(expenseCond),
      // All-time income ledger total — the Dashboard "Income" KPI, symmetric
      // with the expense total above.
      db
        .select({
          totalIncomeLedger: sql<number>`coalesce(sum(${transactions.amount}::numeric), 0)::float`,
        })
        .from(transactions)
        .where(incomeCond),
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
    const totalExpenses = expenseLedgerAgg[0]?.totalExpenseLedger ?? 0;
    const totalIncome = incomeLedgerAgg[0]?.totalIncomeLedger ?? 0;
    const totalDeposits = txDepositAgg[0]?.totalDeposits ?? 0;
    const depositCount = txDepositAgg[0]?.depositCount ?? 0;
    const totalDividendsDistributed = txDividendAgg[0]?.totalDividends ?? 0;
    const investmentsTotal = investmentAgg[0]?.investmentsTotal ?? 0;
    const investmentsCount = investmentAgg[0]?.investmentsCount ?? 0;

    // Fill 12 FISCAL-YEAR month buckets (month 1 → month 12, oldest → newest)
    // so gaps render as zeros. Aligning to the tenant's fiscal year instead of
    // a rolling 12-month window is what stops the axis from plotting seven
    // months that precede the fiscal year altogether (report issue 16: an
    // FY-2026-27 chart ran 12/2025 → 10/2026). Submission rate = share of
    // active members who deposited that month.
    const byMonth = new Map((monthlyDepositRows || []).map((r) => [r.month, r]));
    const now = new Date();
    let fiscalYearStartMonth = 'July';
    try {
      const [fiscalSettings] = await db
        .select({ start: systemSettings.fiscalYearStart, end: systemSettings.fiscalYearEnd })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1);
      fiscalYearStartMonth = fiscalSettings?.start || 'July';
    } catch {
      // No settings row → the platform default fiscal year (July–June).
    }
    const fyStartYear = fiscalStartYearForDate(now, fiscalYearStartMonth);
    const fiscalMonths = fiscalMonthSequence(fiscalYearStartMonth);
    const startMonthIndex = fiscalMonths[0]?.index ?? 0;
    const monthlyDeposits = fiscalMonths.map((fm) => {
      // 'YYYY-MM' key in fiscal order for this slot (handles the year rollover
      // for months that fall after the calendar new year).
      const key = fiscalMonthKey(fyStartYear, fm, startMonthIndex);
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

    // Funds health: runway = reserves ÷ monthly burn.
    //
    // "Monthly Burn" means the CURRENT calendar month's spend, not a rolling
    // average — reporting a 3-month average made the indicator twice as
    // optimistic as reality when the current month was the heaviest (report
    // issue 10). Fall back to the 3-month average ONLY before the current
    // month has any expenses, so a fresh month doesn't read as zero burn.
    const recentExpenses = expenseRunRateAgg[0]?.recentExpenses ?? 0;
    const currentMonthExpenses = currentMonthExpenseAgg[0]?.currentMonthExpenses ?? 0;
    const avgMonthlyBurn = Math.round((recentExpenses / 3) * 100) / 100;
    const monthlyBurn =
      currentMonthExpenses > 0
        ? Math.round(currentMonthExpenses * 100) / 100
        : avgMonthlyBurn;
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
      totalIncome,
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
