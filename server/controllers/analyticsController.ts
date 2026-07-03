import asyncHandler from 'express-async-handler';
import connectDB, { getDb } from '../db/connection.js';
import { globalStats, members, projects, transactions } from '../db/schema/index.js';
import { eq, and, desc, count, sql, gte } from 'drizzle-orm';
import cache from '../utils/cache.js';

let recalculationTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget debounced wrapper for recalculateAllStats.
 * Use this in controllers to avoid blocking the response and ensure fault tolerance.
 */
const queueStatsRecalculation = (): void => {
  if (recalculationTimeout) {
    clearTimeout(recalculationTimeout);
  }
  recalculationTimeout = setTimeout(() => {
    recalculateAllStats().catch((err: Error) => {
      console.error('Background stats recalculation failed:', err);
    });
  }, 5000); // 5 seconds debounce
};

// @desc Get global statistics for dashboard
// @route GET /api/analytics/stats
// @access Private
const getStats = asyncHandler(async (req, res) => {
  const db = getDb();
  const statsResult = await db.select().from(globalStats).limit(1);

  // If no stats exist yet, create initial one
  if (!statsResult.length) {
    const stats = await recalculateAllStats();
    res.json(stats);
    return;
  }

  res.json(statsResult[0]);
});

// @desc Manually trigger stats recalculation
// @route POST /api/analytics/recalculate
// @access Private (Admin)
const triggerRecalculate = asyncHandler(async (req, res) => {
  // Clear cached stats
  cache.del('analytics:stats');

  const stats = await recalculateAllStats();
  res.json({ message: 'Stats recalculated successfully', stats });
});

/**
 * Utility function to perform heavy aggregations and update the GlobalStats document
 * This can be called from controllers when data changes
 */
const recalculateAllStats = async () => {
  const db = getDb();

  // Calculate date range for trend data
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Run all aggregations in parallel for better performance
  const [
    totalMembersResult,
    projectAggregationResult,
    memberAggregationResult,
    transactionAggregationResult,
    trendAggregationResult,
    sectorDiversificationResult,
    topPartnersResult,
    topProjectsResult,
    cashFlowParamsResult
  ] = await Promise.all([
    // Member.countDocuments({ status: 'active' })
    db.select({ count: count() }).from(members).where(eq(members.status, 'active')),

    // Project.aggregate investedCapital and avgYield
    db.select({
      investedCapital: sql<string>`COALESCE(SUM(${projects.initialInvestment}), 0)`,
      avgYield: sql<string>`COALESCE(AVG(${projects.expectedRoi}), 0)`
    }).from(projects),

    // Member.aggregate totalShares for active members
    db.select({
      totalShares: sql<number>`COALESCE(SUM(${members.shares}), 0)`
    }).from(members).where(eq(members.status, 'active')),

    // Transaction.aggregate totalDeposits (type in Deposit, Earning)
    db.select({
      totalDeposits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Deposit', 'Earning') THEN ${transactions.amount} ELSE 0 END), 0)`
    }).from(transactions).where(eq(transactions.status, 'Completed')),

    // Transaction.aggregate trend data (last 6 months, grouped by year/month)
    db.select({
      year: sql<number>`EXTRACT(YEAR FROM ${transactions.date})`,
      month: sql<number>`EXTRACT(MONTH FROM ${transactions.date})`,
      inflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Deposit', 'Earning', 'Investment') THEN ${transactions.amount} ELSE 0 END), 0)`,
      outflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Expense', 'Withdrawal', 'Dividend') THEN ${transactions.amount} ELSE 0 END), 0)`
    }).from(transactions)
      .where(and(
        gte(transactions.date, sixMonthsAgo),
        eq(transactions.status, 'Completed')
      ))
      .groupBy(
        sql`EXTRACT(YEAR FROM ${transactions.date})`,
        sql`EXTRACT(MONTH FROM ${transactions.date})`
      )
      .orderBy(
        sql`EXTRACT(YEAR FROM ${transactions.date})`,
        sql`EXTRACT(MONTH FROM ${transactions.date})`
      ),

    // Project.aggregate sector diversification (group by category)
    db.select({
      category: projects.category,
      value: sql<string>`COALESCE(SUM(${projects.initialInvestment}), 0)`
    }).from(projects).groupBy(projects.category),

    // Member.find top 6 by shares
    db.select({
      name: members.name,
      shares: members.shares
    }).from(members)
      .where(eq(members.status, 'active'))
      .orderBy(desc(members.shares))
      .limit(6),

    // Project.find top 4 by expected_roi
    db.select({
      title: projects.title,
      expectedRoi: projects.expectedRoi
    }).from(projects)
      .orderBy(desc(projects.expectedRoi))
      .limit(4),

    // Transaction.aggregate total inflow/outflow
    db.select({
      totalInflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Deposit', 'Earning', 'Investment', 'Dividend') THEN ${transactions.amount} ELSE 0 END), 0)`,
      totalOutflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Withdrawal', 'Expense') THEN ${transactions.amount} ELSE 0 END), 0)`
    }).from(transactions).where(eq(transactions.status, 'Completed'))
  ]);

  // Convert aggregation result to trend data format
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const trendDataMap = new Map<string, { inflow: string; outflow: string }>();
  trendAggregationResult.forEach(item => {
    const key = `${item.year}-${item.month}`;
    trendDataMap.set(key, { inflow: item.inflow, outflow: item.outflow });
  });

  // Use 'now' from earlier declaration
  const trendData: Array<{ month: string; inflow: number; outflow: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const data = trendDataMap.get(key) || { inflow: '0', outflow: '0' };
    trendData.push({
      month: monthNames[d.getMonth()],
      inflow: Number(data.inflow),
      outflow: Number(data.outflow)
    });
  }

  // Process results from parallel queries
  const totalMembers = Number(totalMembersResult[0]?.count || 0);
  const investedCapital = projectAggregationResult[0]?.investedCapital || '0';
  const avgYield = projectAggregationResult[0]?.avgYield || '0';
  const totalShares = memberAggregationResult[0]?.totalShares || 0;
  const totalDepositsVal = transactionAggregationResult[0]?.totalDeposits || '0';
  const maxShares = topPartnersResult.length > 0 ? Number(topPartnersResult[0].shares) : 100;

  const formattedTopProjects = topProjectsResult.map(p => ({
    title: p.title,
    roi: Number(p.expectedRoi || 0)
  }));

  // Top Investor for the summary card
  const topInvestor = topPartnersResult.length > 0
    ? { name: topPartnersResult[0].name, role: 'Principal Partner' }
    : { name: 'N/A', role: 'N/A' };

  // Calculate Fund Stability (NAV Ratio)
  const totalInflow = Number(cashFlowParamsResult[0]?.totalInflow || 0);
  const totalOutflow = Number(cashFlowParamsResult[0]?.totalOutflow || 0);
  const investedCapitalNum = Number(investedCapital);
  const cashBalance = totalInflow - totalOutflow - investedCapitalNum;

  const totalAssets = investedCapitalNum + Math.max(0, cashBalance);
  const fundStability = Math.min(100, (totalAssets / Number(totalDepositsVal)) * 100).toFixed(1);

  const statsData = {
    totalMembers,
    investedCapital,
    totalShares,
    totalDeposits: totalDepositsVal,
    yieldIndex: avgYield,
    trendData,
    sectorDiversification: sectorDiversificationResult,
    topPartners: topPartnersResult,
    maxShares,
    topProjects: formattedTopProjects,
    topInvestor,
    fundStability,
    lastUpdated: new Date()
  };

  // Upsert: find existing stats row, update if found, insert if not
  const existing = await db.select({ id: globalStats.id }).from(globalStats).limit(1);
  if (existing.length > 0) {
    const [updated] = await db.update(globalStats)
      .set(statsData)
      .where(eq(globalStats.id, existing[0].id))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(globalStats)
      .values(statsData)
      .returning();
    return created;
  }
};

export { getStats, triggerRecalculate, recalculateAllStats, queueStatsRecalculation };
