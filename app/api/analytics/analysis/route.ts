import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/index";
import { members, projects, funds, transactions } from "@/db/schema/index";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { getAuthContext } from "@/lib/middleware/auth";
import { requireTenant } from '@/lib/tenant';
import { AnalysisData } from "@/types";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_KEYS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const scopedTenantId = requireTenant(tenantId, user);

    const searchParams = new URL(request.url).searchParams;
    const yearParam = searchParams.get("year");
    const targetYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const selectedMemberId = searchParams.get("memberId") || "all";

    const db = getDb();

    // 1. Scoped conditions (unconditional — scopedTenantId 403s on null via requireTenant above).
    const memberCond = eq(members.tenantId, scopedTenantId);
    const projectCond = eq(projects.tenantId, scopedTenantId);
    const fundCond = and(eq(funds.status, "ACTIVE"), eq(funds.tenantId, scopedTenantId));

    // Start & end of target year
    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const txConditions = [
      eq(transactions.isDeleted, false),
      gte(transactions.date, startOfYear),
      lte(transactions.date, endOfYear),
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
          status: transactions.status,
          memberId: transactions.memberId,
        })
        .from(transactions)
        .where(and(...txConditions)),
      db
        .select({
          totalDeposits: sql<number>`coalesce(sum(case when ${transactions.type} = 'Deposit' then ${transactions.amount}::numeric else 0 end), 0)::float`,
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

    // 3. Aggregate Monthly Trends
    const monthlyTrends = Array.from({ length: 12 }, (_, i) => ({
      month: MONTH_NAMES[i] ?? `M${i + 1}`,
      monthKey: MONTH_KEYS[i] ?? `m${i + 1}`,
      inflow: 0,
      outflow: 0,
      net: 0,
    }));

    for (const tx of yearTransactions) {
      if (!tx.date) continue;
      const mIdx = new Date(tx.date).getMonth();
      const trend = monthlyTrends[mIdx];
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
    const sectorMap = new Map<string, { value: number; count: number }>();
    let totalProjectCapital = 0;

    for (const p of allProjects) {
      const cat = p.category || "General";
      const val = p.currentFundBalance > 0 ? p.currentFundBalance : p.budget;
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

    // 6. Payment Regularity Matrix (12 months)
    const currentNow = new Date();
    const currentYear = currentNow.getFullYear();
    const currentMonthIdx = currentNow.getMonth();

    const targetMembers = selectedMemberId === "all"
      ? allMembers
      : allMembers.filter((m) => m.id === selectedMemberId);

    // Map member deposit occurrences by month
    const memberMonthlyPaid = new Map<string, Set<number>>();
    for (const tx of yearTransactions) {
      if (tx.type === "Deposit" && tx.status === "Completed" && tx.memberId && tx.date) {
        const m = new Date(tx.date).getMonth();
        if (!memberMonthlyPaid.has(tx.memberId)) {
          memberMonthlyPaid.set(tx.memberId, new Set());
        }
        memberMonthlyPaid.get(tx.memberId)!.add(m);
      }
    }

    let totalExpectedSlots = 0;
    let totalPaidSlots = 0;

    const paymentMatrix = targetMembers.map((m) => {
      const months: Record<string, "PAID" | "PENDING" | "MISSED"> = {};
      const paidSet = memberMonthlyPaid.get(m.id) || new Set();

      let paidCount = 0;
      let evaluatedSlots = 0;

      for (let i = 0; i < 12; i++) {
        const key = MONTH_KEYS[i] || `m${i + 1}`;
        const hasPassed = targetYear < currentYear || (targetYear === currentYear && i <= currentMonthIdx);

        if (paidSet.has(i)) {
          months[key] = "PAID";
          paidCount++;
          if (hasPassed) {
            totalPaidSlots++;
            evaluatedSlots++;
          }
        } else if (hasPassed) {
          months[key] = "MISSED";
          evaluatedSlots++;
        } else {
          months[key] = "PENDING";
        }

        if (hasPassed) totalExpectedSlots++;
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
    const totalAssetValue = Number((totalProjectCapital + netReserves).toFixed(2));
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
