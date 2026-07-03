import asyncHandler from 'express-async-handler';
import cache from '../utils/cache.js';
import { getDb, getSql } from '../db/connection.js';
import { members, projects, transactions, globalStats, globalStatsTrends, globalStatsSectors } from '../db/schema/index.js';
import { eq, count, sum, sql, gte } from 'drizzle-orm';

let recalculationTimeout = null;

/**
 * Fire-and-forget debounced wrapper for recalculateAllStats.
 * Use this in controllers to avoid blocking the response and ensure fault tolerance.
 */
const queueStatsRecalculation = () => {
  if (recalculationTimeout) {
    clearTimeout(recalculationTimeout);
  }
  recalculationTimeout = setTimeout(() => {
    recalculateAllStats().catch(err => {
      console.error('Background stats recalculation failed:', err);
    });
  }, 5000); // 5 seconds debounce
};

// @desc Get global statistics for dashboard
// @route GET /api/analytics/stats
// @access Private
const getStats = asyncHandler(async (req, res) => {
  const db = getDb();
  const [stats] = await db.select().from(globalStats).limit(1);

  // If no stats exist yet, create initial one
  if (!stats) {
    const newStats = await recalculateAllStats();
    return res.json(newStats);
  }

  // Fetch child data (trends and sectors)
  const trends = await db.select().from(globalStatsTrends)
    .where(eq(globalStatsTrends.globalStatsId, stats.id))
    .orderBy(globalStatsTrends.createdAt);
  const sectors = await db.select().from(globalStatsSectors)
    .where(eq(globalStatsSectors.globalStatsId, stats.id));

  res.json({
    ...stats,
    trendData: trends.map(t => ({ month: t.month, inflow: Number(t.inflow), outflow: Number(t.outflow) })),
    sectorDiversification: sectors.map(s => ({ category: s.category, value: Number(s.value) })),
  });
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
 * Utility function to perform heavy aggregations and update stats
 */
const recalculateAllStats = async () => {
  const db = getDb();
  const pg = getSql();
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Run all aggregations in parallel
  const [
    totalMembersResult,
    projectAggregation,
    memberAggregation,
    transactionAggregation,
    trendAggregation,
    sectorDiversification,
    topPartners,
    topProjects,
    cashFlowParams,
  ] = await Promise.all([
    // Total active members
    db.select({ count: count() }).from(members).where(eq(members.status, 'active')),

    // Project aggregation
    pg`
      SELECT
        COALESCE(SUM(initial_investment), 0) as invested_capital,
        COALESCE(AVG(expected_roi), 0) as avg_yield
      FROM projects
    `,

    // Member aggregation (active members total shares)
    pg`
      SELECT COALESCE(SUM(shares), 0) as total_shares
      FROM members WHERE status = 'active'
    `,

    // Transaction aggregation (completed deposits + earnings)
    pg`
      SELECT COALESCE(SUM(
        CASE WHEN type IN ('Deposit', 'Earning') THEN amount ELSE 0 END
      ), 0) as total_deposits
      FROM transactions WHERE status = 'Completed'
    `,

    // Trend data (last 6 months)
    pg`
      SELECT
        EXTRACT(YEAR FROM date)::int as year,
        EXTRACT(MONTH FROM date)::int as month,
        COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount ELSE 0 END), 0) as inflow,
        COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend') THEN amount ELSE 0 END), 0) as outflow
      FROM transactions
      WHERE date >= ${sixMonthsAgo.toISOString()} AND status = 'Completed'
      GROUP BY year, month
      ORDER BY year, month
    `,

    // Sector diversification
    pg`
      SELECT category, COALESCE(SUM(initial_investment), 0) as value
      FROM projects
      GROUP BY category
    `,

    // Top partners (by shares)
    db.select({ name: members.name, shares: members.shares })
      .from(members)
      .where(eq(members.status, 'active'))
      .orderBy(sql`shares DESC`)
      .limit(6),

    // Top projects
    db.select({ title: projects.title, projectedReturn: projects.expectedRoi })
      .from(projects)
      .orderBy(sql`expected_roi DESC`)
      .limit(4),

    // Cash flow params
    pg`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment', 'Dividend') THEN amount ELSE 0 END), 0) as total_inflow,
        COALESCE(SUM(CASE WHEN type IN ('Withdrawal', 'Expense') THEN amount ELSE 0 END), 0) as total_outflow
      FROM transactions WHERE status = 'Completed'
    `,
  ]);

  // Process trend data
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const trendDataMap = new Map();
  for (const item of trendAggregation) {
    trendDataMap.set(`${item.year}-${item.month}`, { inflow: Number(item.inflow), outflow: Number(item.outflow) });
  }

  const trendData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const data = trendDataMap.get(key) || { inflow: 0, outflow: 0 };
    trendData.push({
      month: monthNames[d.getMonth()],
      inflow: data.inflow,
      outflow: data.outflow,
    });
  }

  // Process results
  const totalMembers = Number(totalMembersResult[0]?.count || 0);
  const investedCapital = Number(projectAggregation[0]?.invested_capital || 0);
  const totalShares = Number(memberAggregation[0]?.total_shares || 0);
  const totalDeposits = Number(transactionAggregation[0]?.total_deposits || 1);
  const avgYield = Number(projectAggregation[0]?.avg_yield || 0);
  const totalInflow = Number(cashFlowParams[0]?.total_inflow || 0);
  const totalOutflow = Number(cashFlowParams[0]?.total_outflow || 0);
  const cashBalance = totalInflow - totalOutflow - investedCapital;
  const totalAssets = investedCapital + Math.max(0, cashBalance);
  const fundStability = Math.min(100, (totalAssets / totalDeposits) * 100).toFixed(1);

  const formattedTopProjects = topProjects.map(p => ({
    title: p.title,
    roi: parseFloat(p.projectedReturn) || 0,
  }));

  const topInvestor = topPartners.length > 0
    ? { name: topPartners[0].name, role: 'Principal Partner' }
    : { name: 'N/A', role: 'N/A' };

  const maxShares = topPartners.length > 0 ? topPartners[0].shares : 100;

  // Upsert global stats (delete old + insert new within a transaction)
  const result = await db.transaction(async (tx) => {
    // Delete existing stats and children
    const [existing] = await tx.select({ id: globalStats.id }).from(globalStats).limit(1);
    if (existing) {
      await tx.delete(globalStatsTrends).where(eq(globalStatsTrends.globalStatsId, existing.id));
      await tx.delete(globalStatsSectors).where(eq(globalStatsSectors.globalStatsId, existing.id));
      await tx.delete(globalStats).where(eq(globalStats.id, existing.id));
    }

    // Insert new stats
    const [newStats] = await tx.insert(globalStats).values({
      totalDeposits: String(totalDeposits),
      investedCapital: String(investedCapital),
      totalMembers,
      totalShares,
      yieldIndex: String(avgYield),
      fundStability: String(fundStability),
      lastUpdated: new Date(),
    }).returning();

    // Insert trends
    if (trendData.length > 0) {
      await tx.insert(globalStatsTrends).values(
        trendData.map(t => ({
          globalStatsId: newStats.id,
          month: t.month,
          inflow: String(t.inflow),
          outflow: String(t.outflow),
        }))
      );
    }

    // Insert sectors
    if (sectorDiversification.length > 0) {
      await tx.insert(globalStatsSectors).values(
        sectorDiversification.map(s => ({
          globalStatsId: newStats.id,
          category: s.category,
          value: String(s.value),
        }))
      );
    }

    return {
      totalMembers,
      investedCapital,
      totalShares,
      totalDeposits,
      yieldIndex: avgYield,
      fundStability,
      trendData,
      sectorDiversification: sectorDiversification.map(s => ({ category: s.category, value: Number(s.value) })),
      topPartners,
      maxShares,
      topProjects: formattedTopProjects,
      topInvestor,
      lastUpdated: new Date(),
    };
  });

  return result;
};

export { getStats, triggerRecalculate, recalculateAllStats, queueStatsRecalculation };
