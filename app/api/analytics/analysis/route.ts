import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/index";
import { members, projects, funds, transactions, systemSettings } from "@/db/schema/index";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { getAuthContext } from "@/lib/middleware/auth";
import { requireTenant } from '@/lib/tenant';
import { fiscalMonthOffsetForDate, fiscalMonthSequence, fiscalStartYearForDate, isFiscalMonthEvaluated, resolveFiscalBounds } from "@/lib/fiscal-periods";
import { AnalysisData } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const scopedTenantId = requireTenant(tenantId, user);

    const searchParams = new URL(request.url).searchParams;
    const yearParam = searchParams.get("year");
    const selectedMemberId = searchParams.get("memberId") || "all";

    const db = getDb();
    const [fiscalSettings] = await db
      .select({
        fiscalYearStart: systemSettings.fiscalYearStart,
        fiscalYearEnd: systemSettings.fiscalYearEnd,
      })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, scopedTenantId))
      .limit(1);
    const fiscalYearStart = fiscalSettings?.fiscalYearStart || "July";
    const fiscalYearEnd = fiscalSettings?.fiscalYearEnd || "June";
    const now = new Date();
    const parsedYear = yearParam === null ? fiscalStartYearForDate(now, fiscalYearStart) : Number(yearParam);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 9998) {
      return NextResponse.json(
        { success: false, message: "Fiscal year must be an integer from 1900 to 9998" },
        { status: 400 },
      );
    }
    const targetYear = parsedYear;
    const fiscalBounds = resolveFiscalBounds(targetYear, fiscalYearStart, fiscalYearEnd);
    const fiscalMonths = fiscalMonthSequence(fiscalYearStart);

    // 1. Scoped conditions (unconditional — scopedTenantId 403s on null via requireTenant above).
    // Members are soft-deleted (members.isDeleted); the analysis roster must
    // not surface a removed member's retained contributions/shares. Matches
    // the dashboard member filter so both screens agree.
    const memberCond = and(eq(members.tenantId, scopedTenantId), eq(members.isDeleted, false));
    const projectCond = eq(projects.tenantId, scopedTenantId);
    const fundCond = and(eq(funds.status, "ACTIVE"), eq(funds.tenantId, scopedTenantId));

    const txConditions = [
      eq(transactions.isDeleted, false),
      gte(transactions.date, fiscalBounds.periodStart),
      lte(transactions.date, fiscalBounds.periodEnd),
    ];
    // Unconditional tenant predicate — scopedTenantId already 403s on null.
    txConditions.push(eq(transactions.tenantId, scopedTenantId));
    if (selectedMemberId !== "all") {
      txConditions.push(eq(transactions.memberId, selectedMemberId));
    }

    // 2. Fetch data in parallel
    const [
      allMembers,
      allProjects,
      activeFunds,
      yearTransactions,
      allTimeTxAgg,
    ] = await Promise.all([
      db
        .select({
          id: members.id,
          memberId: members.memberId,
          name: members.name,
          avatar: members.avatar,
          shares: members.shares,
          totalContributed: sql<number>`coalesce(${members.totalContributed}::numeric, 0)::float`,
          status: members.status,
        })
        .from(members)
        .where(memberCond),
      db
        .select({
          id: projects.id,
          title: projects.title,
          category: projects.category,
          budget: sql<number>`coalesce(${projects.budget}::numeric, 0)::float`,
          currentFundBalance: sql<number>`coalesce(${projects.currentFundBalance}::numeric, 0)::float`,
          health: projects.health,
          status: projects.status,
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
          id: transactions.id,
          type: transactions.type,
          amount: sql<number>`${transactions.amount}::numeric::float`,
          date: transactions.date,
          // #57: a deposit belongs to the month it was deposited FOR, not the
          // month it was keyed in. The Deposits page and its month filter use
          // deposit_month; the chart used the posting date, so the same rows
          // landed in different months across two views of one ledger.
          depositMonth: transactions.depositMonth,
          status: transactions.status,
          memberId: transactions.memberId,
        })
        .from(transactions)
        .where(and(...txConditions)),
      db
        .select({
          // `Deposit` requires a settled status: an unsettled request is not
          // collected capital, and counting it made "Total Capital Invested"
          // disagree with the fund ledger (report issues 27 / 47).
          totalDeposits: sql<number>`coalesce(sum(case when ${transactions.type} = 'Deposit' and ${transactions.status} in ('Completed', 'Success') then ${transactions.amount}::numeric else 0 end), 0)::float`,
          totalDividends: sql<number>`coalesce(sum(case when ${transactions.type} = 'Dividend' then ${transactions.amount}::numeric else 0 end), 0)::float`,
          totalExpenses: sql<number>`coalesce(sum(case when ${transactions.type} = 'Expense' then ${transactions.amount}::numeric else 0 end), 0)::float`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.isDeleted, false),
            eq(transactions.tenantId, scopedTenantId),
            selectedMemberId !== "all" ? eq(transactions.memberId, selectedMemberId) : sql`1=1`,
          ),
        ),
    ]);

    // 3. Aggregate Monthly Trends in configured fiscal-month order.
    const monthlyTrends = fiscalMonths.map(({ key, shortLabel }) => ({
      month: shortLabel,
      monthKey: key,
      inflow: 0,
      outflow: 0,
      net: 0,
    }));

    for (const tx of yearTransactions) {
      if (!tx.date) continue;

      // Bucket by the fiscal month the money belongs to. Deposits carry an
      // explicit `deposit_month` ("YYYY-MM") set by the deposit form — the
      // authoritative month for that money; everything else falls back to its
      // posting date.
      let bucketDate = new Date(tx.date);
      if (tx.type === "Deposit" && tx.depositMonth && /^\d{4}-\d{2}$/.test(tx.depositMonth)) {
        const parts = tx.depositMonth.split("-");
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
          // Anchor mid-month (UTC) so timezone shifts cannot push it into the
          // neighbouring fiscal month.
          bucketDate = new Date(Date.UTC(y, m - 1, 15));
        }
      }

      const monthOffset = fiscalMonthOffsetForDate(bucketDate, fiscalYearStart);
      // A deposit entered inside this FY but made FOR a month in another FY
      // belongs to that FY's bar, not this one's.
      if (fiscalStartYearForDate(bucketDate, fiscalYearStart) !== targetYear) continue;
      const trend = monthlyTrends[monthOffset];
      if (!trend) continue;

      if (tx.type === "Deposit" || tx.type === "Earning") {
        trend.inflow += tx.amount;
      } else if (tx.type === "Expense" || tx.type === "Dividend" || tx.type === "Withdrawal") {
        trend.outflow += tx.amount;
      }
    }

    monthlyTrends.forEach((t) => {
      t.net = Number((t.inflow - t.outflow).toFixed(2));
      t.inflow = Number(t.inflow.toFixed(2));
      t.outflow = Number(t.outflow.toFixed(2));
    });

    // 4. Sector Allocations
    //
    // #14: "Capital Allocation by Sector" must mean ONE thing across the app.
    // The metric is **committed capital** — the project's budget, i.e. the
    // money set aside for it — which is exactly what the Dashboard's "Capital
    // by Sector" already sums (40,000 for a 40,000-budget project). The previous
    // `currentFundBalance > 0 ? currentFundBalance : budget` expression was a
    // THIRD measure (remaining balance) that made the same label read 10,000 on
    // Analysis and 40,000 on the Dashboard. `budget` is the single definition;
    // "capital deployed so far" lives elsewhere (project detail / spend columns).
    const sectorMap = new Map<string, { value: number; count: number }>();
    let totalProjectCapital = 0;

    for (const p of allProjects) {
      const cat = p.category || "General";
      const val = p.budget;
      totalProjectCapital += val;

      const existing = sectorMap.get(cat) || { value: 0, count: 0 };
      existing.value += val;
      existing.count += 1;
      sectorMap.set(cat, existing);
    }

    const sectorAllocations = Array.from(sectorMap.entries()).map(([name, data]) => ({
      name,
      value: Number(data.value.toFixed(2)),
      count: data.count,
      percentage: totalProjectCapital > 0 ? Number(((data.value / totalProjectCapital) * 100).toFixed(1)) : 0,
    }));

    // 5. Risk / Health Distribution
    const healthMap = new Map<string, { count: number; value: number }>();
    for (const p of allProjects) {
      const h = p.health || "Stable";
      const existing = healthMap.get(h) || { count: 0, value: 0 };
      existing.count += 1;
      existing.value += p.budget;
      healthMap.set(h, existing);
    }

    const riskDistribution = Array.from(healthMap.entries()).map(([health, data]) => ({
      health,
      count: data.count,
      value: Number(data.value.toFixed(2)),
    }));

    // 6. Payment Regularity Matrix (12 months in fiscal order)
    const currentNow = now;

    const targetMembers = selectedMemberId === "all"
      ? allMembers
      : allMembers.filter((m) => m.id === selectedMemberId);

    // Map member deposit occurrences by fiscal-month offset — bucketed by the
    // deposit's OWN month (`deposit_month`), exactly like the monthly-trends
    // chart above (#57) and the deposits ledger. A January contribution keyed
    // in October counts for January. Settled means Completed/Success (the
    // collected-capital definition used by every other money view). A deposit
    // whose deposit month falls outside the requested FY is skipped, so a
    // same-calendar-month deposit from another year cannot mark this FY paid.
    const memberMonthlyPaid = new Map<string, Set<number>>();
    for (const tx of yearTransactions) {
      if (tx.type !== "Deposit" || !tx.memberId || !tx.date) continue;
      if (tx.status !== "Completed" && tx.status !== "Success") continue;
      let bucketDate = new Date(tx.date);
      if (tx.depositMonth && /^\d{4}-\d{2}$/.test(tx.depositMonth)) {
        const parts = tx.depositMonth.split("-");
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
          bucketDate = new Date(Date.UTC(y, m - 1, 15));
        }
      }
      if (fiscalStartYearForDate(bucketDate, fiscalYearStart) !== targetYear) continue;
      const monthOffset = fiscalMonthOffsetForDate(bucketDate, fiscalYearStart);
      if (!memberMonthlyPaid.has(tx.memberId)) {
        memberMonthlyPaid.set(tx.memberId, new Set());
      }
      memberMonthlyPaid.get(tx.memberId)!.add(monthOffset);
    }

    let totalExpectedSlots = 0;
    let totalPaidSlots = 0;

    const paymentMatrix = targetMembers.map((m) => {
      const months: Record<string, "PAID" | "PENDING" | "MISSED"> = {};
      const paidSet = memberMonthlyPaid.get(m.id) || new Set();

      let paidCount = 0;
      let evaluatedSlots = 0;

      for (let i = 0; i < 12; i++) {
        const fiscalMonth = fiscalMonths[i];
        if (!fiscalMonth) continue;
        const isEvaluated = isFiscalMonthEvaluated(targetYear, i, currentNow, fiscalYearStart);

        if (paidSet.has(i)) {
          months[fiscalMonth.key] = "PAID";
          if (isEvaluated) {
            paidCount++;
            totalPaidSlots++;
            evaluatedSlots++;
          }
        } else if (isEvaluated) {
          months[fiscalMonth.key] = "MISSED";
          evaluatedSlots++;
        } else {
          months[fiscalMonth.key] = "PENDING";
        }

        if (isEvaluated) totalExpectedSlots++;
      }

      const punctualityScore = evaluatedSlots > 0 ? Number(((paidCount / evaluatedSlots) * 100).toFixed(0)) : 100;

      return {
        id: m.id,
        memberId: m.memberId,
        name: m.name,
        avatar: m.avatar || undefined,
        months,
        punctualityScore,
      };
    });

    const collectionEfficiency = totalExpectedSlots > 0
      ? Number(((totalPaidSlots / totalExpectedSlots) * 100).toFixed(1))
      : 100;

    // 7. Leaderboard & Equity Percentages
    const totalSharesAll = allMembers.reduce((sum, m) => sum + (m.shares || 0), 0);
    const sortedMembers = [...allMembers].sort((a, b) => b.totalContributed - a.totalContributed);

    const leaderboard = sortedMembers.slice(0, 15).map((m, idx) => ({
      rank: idx + 1,
      id: m.id,
      memberId: m.memberId,
      name: m.name,
      avatar: m.avatar || undefined,
      shares: m.shares,
      totalContributed: Number(m.totalContributed.toFixed(2)),
      equitySharePercent: totalSharesAll > 0 ? Number(((m.shares / totalSharesAll) * 100).toFixed(2)) : 0,
    }));

    // 8. Overall Financial Metrics
    const totalInvested = allTimeTxAgg[0]?.totalDeposits ?? 0;
    const totalDividends = allTimeTxAgg[0]?.totalDividends ?? 0;
    const netReserves = activeFunds[0]?.netReserves ?? 0;
    // Consolidated Portfolio Value = the tenant's total treasury.
    //
    // It must NOT be `totalProjectCapital + netReserves`: creating a project
    // CREDITS its starting capital to the linked fund (app/api/projects/route.ts
    // line ~251) while the SAME amount is also stored as
    // `projects.currentFundBalance` (line ~275). Summing both counted that money
    // twice — Analysis read 195,000 where the Funds module correctly read
    // 180,000 (report issue 13). Fund balances are the single source of truth
    // and already contain every project's capital, so the consolidated value is
    // the treasury itself.
    const totalAssetValue = Number(netReserves.toFixed(2));
    const netProfit = Number((totalAssetValue + totalDividends - totalInvested).toFixed(2));
    const roi = totalInvested > 0 ? Number(((netProfit / totalInvested) * 100).toFixed(1)) : 0;
    const activeProjectsCount = allProjects.filter((p) => p.status === "In Progress").length;

    const responseData: AnalysisData = {
      metrics: {
        totalInvested: Number(totalInvested.toFixed(2)),
        totalAssetValue,
        netProfit,
        roi,
        totalDividends: Number(totalDividends.toFixed(2)),
        activeProjects: activeProjectsCount,
        collectionEfficiency,
      },
      monthlyTrends,
      sectorAllocations,
      riskDistribution,
      paymentMatrix,
      leaderboard,
    };

    return NextResponse.json(responseData);
  } catch (err: unknown) {
    const error = err as Error & { statusCode?: number };
    console.error("[ANALYTICS ANALYSIS GET ERROR]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to compile financial analysis" },
      { status: error.statusCode || 500 },
    );
  }
}
