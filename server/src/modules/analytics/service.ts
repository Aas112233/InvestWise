import { getDb, getSql as getRawSql } from '../../config/database.js';
import {
  members,
  projects,
  globalStats,
  globalStatsTrends,
  globalStatsSectors,
} from '../../db/schema/index.js';
import { eq, count, sql } from 'drizzle-orm';
import { cache } from '../../lib/cache.js';

const STATS_CACHE_KEY = 'analytics:stats';
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — dashboard data doesn't change second-by-second

let recalculationTimeout: ReturnType<typeof setTimeout> | null = null;
let lastRecalculationTime = 0;
const MIN_RECALC_INTERVAL = 60 * 1000; // 1 minute — throttle full recalculations

/**
 * Fire-and-forget debounced wrapper for recalculateAllStats.
 * Use this in other modules (deposit, expense, member create, etc.) to
 * refresh dashboard data without blocking the response.
 *
 * - Debounce interval: 30 seconds (multiple rapid writes only trigger ONE
 *   recalculation after the dust settles).
 * - Throttle: skips recalculation if it ran less than MIN_RECALC_INTERVAL
 *   (60 seconds) ago — prevents write-heavy bursts from hammering the DB.
 */
export function queueStatsRecalculation(): void {
  if (recalculationTimeout) {
    clearTimeout(recalculationTimeout);
  }
  recalculationTimeout = setTimeout(() => {
    // Skip if a recalculation happened very recently
    if (Date.now() - lastRecalculationTime < MIN_RECALC_INTERVAL) {
      return;
    }
    recalculateAllStats().catch((err) => {
      console.error('Background stats recalculation failed:', err);
    });
  }, 30_000);
}

interface TrendItem {
  month: string;
  inflow: number;
  outflow: number;
}

interface SectorItem {
  category: string;
  value: number;
}

interface StatsResponse {
  totalMembers: number;
  investedCapital: number;
  totalShares: number;
  totalDeposits: number;
  yieldIndex: number;
  fundStability: number;
  lastUpdated: Date | null;
  trendData: TrendItem[];
  sectorDiversification: SectorItem[];
}

interface RecalcResponse extends StatsResponse {
  topPartners: Array<{ name: string; shares: number }>;
  maxShares: number;
  topProjects: Array<{ title: string; roi: number }>;
  topInvestor: { name: string; role: string };
}

function getDefaultStats(): StatsResponse {
  return {
    totalMembers: 0,
    investedCapital: 0,
    totalShares: 0,
    totalDeposits: 0,
    yieldIndex: 0,
    fundStability: 100,
    lastUpdated: null,
    trendData: [],
    sectorDiversification: [],
  };
}

/**
 * Get global statistics for the dashboard.
 * Results are cached for 5 minutes to avoid hitting the DB on every
 * dashboard refresh. The cache is invalidated when recalculateAllStats runs.
 * If no stats exist, returns zero-filled defaults.
 */
export async function getStats(): Promise<StatsResponse> {
  return cache.getOrSet(STATS_CACHE_KEY, async () => {
    const db = getDb();
    const [stats] = await db.select().from(globalStats).limit(1);

    if (!stats) {
      return getDefaultStats();
    }

    const [trends, sectors] = await Promise.all([
      db
        .select()
        .from(globalStatsTrends)
        .where(eq(globalStatsTrends.globalStatsId, stats.id))
        .orderBy(globalStatsTrends.createdAt),
      db
        .select()
        .from(globalStatsSectors)
        .where(eq(globalStatsSectors.globalStatsId, stats.id)),
    ]);

    return {
      totalMembers: Number(stats.totalMembers),
      investedCapital: Number(stats.investedCapital),
      totalShares: Number(stats.totalShares),
      totalDeposits: Number(stats.totalDeposits),
      yieldIndex: Number(stats.yieldIndex),
      fundStability: Number(stats.fundStability),
      lastUpdated: stats.lastUpdated ?? null,
      trendData: trends.map((t) => ({
        month: t.month,
        inflow: Number(t.inflow),
        outflow: Number(t.outflow),
      })),
      sectorDiversification: sectors.map((s) => ({
        category: s.category,
        value: Number(s.value),
      })),
    };
  }, STATS_CACHE_TTL);
}

/**
 * Heavy aggregation that recalculates all statistics from source tables.
 * Runs parallel queries and upserts results in a single transaction.
 */
let recalculationPromise: Promise<RecalcResponse> | null = null;

export async function recalculateAllStats(): Promise<RecalcResponse> {
  if (recalculationPromise) {
    return recalculationPromise;
  }

  recalculationPromise = (async () => {
    try {
      const db = getDb();
      const pg = getRawSql();
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];

      // Run all aggregations in parallel with a timeout safety net
      const aggregationPromise = Promise.all([
        // 1. Active member count
        db
          .select({ count: count() })
          .from(members)
          .where(eq(members.status, 'active')),

        // 2. Sum of project initial_investment + avg expected ROI
        pg`
          SELECT
            COALESCE(SUM(initial_investment), 0) AS invested_capital,
            COALESCE(AVG(expected_roi), 0)       AS avg_yield
          FROM projects
        `,

        // 3. Sum of member shares (active)
        pg`
          SELECT COALESCE(SUM(shares), 0) AS total_shares
          FROM members
          WHERE status = 'active'
        `,

        // 4. Sum of deposits + earnings (status Success or Completed)
        pg`
          SELECT COALESCE(SUM(
            CASE WHEN type IN ('Deposit', 'Earning') THEN amount ELSE 0 END
          ), 0) AS total_deposits
          FROM transactions
          WHERE status IN ('Completed')
            AND is_deleted = false
        `,

        // 5. 6-month trend: monthly inflow / outflow
        pg`
          SELECT
            EXTRACT(YEAR  FROM date)::int  AS year,
            EXTRACT(MONTH FROM date)::int  AS month,
            COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment')          THEN amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend')         THEN amount ELSE 0 END), 0) AS outflow
          FROM transactions
          WHERE date >= ${sixMonthsAgo.toISOString()}
            AND status IN ('Completed')
            AND is_deleted = false
          GROUP BY year, month
          ORDER BY year, month
        `,

        // 6. Sector diversification
        pg`
          SELECT category, COALESCE(SUM(initial_investment), 0) AS value
          FROM projects
          GROUP BY category
        `,

        // 7. Top partners by shares (top 6)
        db
          .select({ name: members.name, shares: members.shares })
          .from(members)
          .where(eq(members.status, 'active'))
          .orderBy(sql`shares DESC`)
          .limit(6),

        // 8. Top projects by ROI (top 4)
        db
          .select({ title: projects.title, projectedReturn: projects.expectedRoi })
          .from(projects)
          .orderBy(sql`expected_roi DESC`)
          .limit(4),

        // 9. Total inflow vs outflow (CASE-based aggregation)
        pg`
          SELECT
            COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment', 'Dividend') THEN amount ELSE 0 END), 0) AS total_inflow,
            COALESCE(SUM(CASE WHEN type IN ('Withdrawal', 'Expense')                         THEN amount ELSE 0 END), 0) AS total_outflow
          FROM transactions
          WHERE status IN ('Completed')
            AND is_deleted = false
        `,
      ]);

      // Enforce a 12 second timeout on the DB queries to prevent blocking the Node.js event loop
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database query timeout during analytics recalculation')), 12000)
      );

      const [
        totalMembersResult,
        projectAggregation,
        memberAggregation,
        transactionAggregation,
        trendAggregation,
        sectorDiversificationRows,
        topPartnersRows,
        topProjectsRows,
        cashFlowParams,
      ] = await Promise.race([aggregationPromise, timeoutPromise]);

      // --- Process trend data ---
      const trendDataMap = new Map<string, { inflow: number; outflow: number }>();
      for (const row of trendAggregation) {
        const key = `${row.year}-${row.month}`;
        trendDataMap.set(key, { inflow: Number(row.inflow), outflow: Number(row.outflow) });
      }

      const trendData: TrendItem[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        const data = trendDataMap.get(key) ?? { inflow: 0, outflow: 0 };
        trendData.push({ month: monthNames[d.getMonth()], inflow: data.inflow, outflow: data.outflow });
      }

      // --- Compute derived metrics ---
      const totalMembers = Number(totalMembersResult[0]?.count ?? 0);
      const investedCapital = Number(projectAggregation[0]?.invested_capital ?? 0);
      const totalShares = Number(memberAggregation[0]?.total_shares ?? 0);
      const totalDeposits = Math.max(Number(transactionAggregation[0]?.total_deposits ?? 0), 1);
      const avgYield = Number(projectAggregation[0]?.avg_yield ?? 0);
      const totalInflow = Number(cashFlowParams[0]?.total_inflow ?? 0);
      const totalOutflow = Number(cashFlowParams[0]?.total_outflow ?? 0);

      const cashBalance = totalInflow - totalOutflow - investedCapital;
      const totalAssets = investedCapital + Math.max(0, cashBalance);
      const fundStability = Number(Math.min(100, (totalAssets / totalDeposits) * 100).toFixed(1));

      const formattedTopProjects = topProjectsRows.map((p) => ({
        title: p.title,
        roi: Number(p.projectedReturn) || 0,
      }));

      const topInvestor =
        topPartnersRows.length > 0
          ? { name: topPartnersRows[0].name, role: 'Principal Partner' as const }
          : { name: 'N/A', role: 'N/A' as const };

      const maxShares = topPartnersRows.length > 0 ? Number(topPartnersRows[0].shares) : 100;

      const sectorDiversification = sectorDiversificationRows.map((s) => ({
        category: s.category,
        value: Number(s.value),
      }));

      // --- UPSERT inside a transaction ---
      const result = await db.transaction(async (tx) => {
        // Delete existing stats and child rows
        const [existing] = await tx.select({ id: globalStats.id }).from(globalStats).limit(1);
        if (existing) {
          await tx.delete(globalStatsTrends).where(eq(globalStatsTrends.globalStatsId, existing.id));
          await tx.delete(globalStatsSectors).where(eq(globalStatsSectors.globalStatsId, existing.id));
          await tx.delete(globalStats).where(eq(globalStats.id, existing.id));
        }

        // Insert fresh stats row
        const [newStats] = await tx
          .insert(globalStats)
          .values({
            totalDeposits: String(totalDeposits),
            investedCapital: String(investedCapital),
            totalMembers,
            totalShares,
            yieldIndex: String(avgYield),
            fundStability: String(fundStability),
            lastUpdated: new Date(),
          })
          .returning();

        // Insert trends
        if (trendData.length > 0) {
          await tx.insert(globalStatsTrends).values(
            trendData.map((t) => ({
              globalStatsId: newStats.id,
              month: t.month,
              inflow: String(t.inflow),
              outflow: String(t.outflow),
            })),
          );
        }

        // Insert sectors
        if (sectorDiversification.length > 0) {
          await tx.insert(globalStatsSectors).values(
            sectorDiversification.map((s) => ({
              globalStatsId: newStats.id,
              category: s.category,
              value: String(s.value),
            })),
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
          sectorDiversification,
          topPartners: topPartnersRows.map((p) => ({ name: p.name, shares: Number(p.shares) })),
          maxShares,
          topProjects: formattedTopProjects,
          topInvestor,
          lastUpdated: new Date(),
        };
      });

      // Invalidate the dashboard cache so the next request picks up fresh data
      cache.del(STATS_CACHE_KEY);
      lastRecalculationTime = Date.now();

      return result;
    } catch (error) {
      console.error('Error during analytics recalculation:', error);
      throw error;
    } finally {
      recalculationPromise = null;
    }
  })();

  return recalculationPromise;
}
