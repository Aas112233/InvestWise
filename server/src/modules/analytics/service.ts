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
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let recalculationTimeout: ReturnType<typeof setTimeout> | null = null;
let lastRecalculationTime = 0;
const MIN_RECALC_INTERVAL = 60 * 1000; // 1 minute

export function queueStatsRecalculation(): void {
  if (recalculationTimeout) {
    clearTimeout(recalculationTimeout);
  }
  recalculationTimeout = setTimeout(() => {
    if (Date.now() - lastRecalculationTime < MIN_RECALC_INTERVAL) {
      return;
    }
    recalculateAllStats().catch((err) => {
      console.error('Background stats recalculation failed:', err);
    });
  }, 30_000);
}

export interface TrendItem {
  month: string;
  deposit?: number;
  inflow: number;
  outflow: number;
  netProfit?: number;
  cumulativeBalance?: number;
}

export interface SectorItem {
  category: string;
  value: number;
  percentage?: number;
}

export interface GovernanceMetrics {
  totalMeetings: number;
  attendanceRate: number;
  onTimeDepositRate: number;
  activePenaltiesCount: number;
}

export interface StatsResponse {
  totalMembers: number;
  investedCapital: number;
  totalShares: number;
  totalDeposits: number;
  yieldIndex: number;
  fundStability: number;
  lastUpdated: Date | null;
  trendData: TrendItem[];
  sectorDiversification: SectorItem[];
  topPartners?: Array<{ name: string; shares: number; totalContributed?: number; performanceScore?: number }>;
  maxShares?: number;
  topProjects?: Array<{ title: string; category?: string; roi: number; earnings?: number; expenses?: number; status?: string; health?: string }>;
  topInvestor?: { name: string; role: string; shares?: number };
  governance?: GovernanceMetrics;
}

export interface RecalcResponse extends StatsResponse {
  topPartners: Array<{ name: string; shares: number; totalContributed?: number; performanceScore?: number }>;
  maxShares: number;
  topProjects: Array<{ title: string; category?: string; roi: number; earnings?: number; expenses?: number; status?: string; health?: string }>;
  topInvestor: { name: string; role: string; shares?: number };
  governance: GovernanceMetrics;
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
 */
export async function getStats(): Promise<StatsResponse> {
  return cache.getOrSet(STATS_CACHE_KEY, async () => {
    const db = getDb();
    const pg = getRawSql();

    // Step 1: Run core stats and live visual components concurrently
    const [[stats], topPartnersRows, topProjectsRows, govStats] = await Promise.all([
      db.select().from(globalStats).limit(1),
      db
        .select({
          name: members.name,
          shares: members.shares,
          totalContributed: members.totalContributed,
          performanceScore: members.performanceScore,
        })
        .from(members)
        .where(eq(members.status, 'active'))
        .orderBy(sql`shares DESC`)
        .limit(6),
      db
        .select({
          title: projects.title,
          category: projects.category,
          roi: projects.expectedRoi,
          earnings: projects.totalEarnings,
          expenses: projects.totalExpenses,
          status: projects.status,
          health: projects.health,
        })
        .from(projects)
        .orderBy(sql`expected_roi DESC`)
        .limit(6),
      pg`
        SELECT
          (SELECT COUNT(*) FROM meetings) AS total_meetings,
          (SELECT COALESCE(ROUND(AVG(CASE WHEN attendance_status = 'PRESENT' THEN 100.0 WHEN attendance_status = 'EXCUSED' THEN 80.0 ELSE 0 END), 1), 100) FROM meeting_attendees) AS attendance_rate,
          (SELECT COALESCE(ROUND(AVG(CASE WHEN deposit_status = 'PAID_ON_TIME' THEN 100.0 WHEN deposit_status = 'PAID_LATE' THEN 70.0 ELSE 0 END), 1), 100) FROM meeting_attendees) AS deposit_rate,
          (SELECT COUNT(*) FROM member_penalties WHERE status = 'ACTIVE') AS active_penalties
      `,
    ]);

    if (!stats) {
      return recalculateAllStats();
    }

    let trends: any[] = [];
    let sectors: any[] = [];

    try {
      [trends, sectors] = await Promise.all([
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
    } catch (queryErr) {
      console.warn('[WARN] Trend query failed, falling back to dynamic recalculation:', queryErr);
      return recalculateAllStats();
    }

    const formattedTopProjects = topProjectsRows.map((p) => ({
      title: p.title,
      category: p.category,
      roi: Number(p.roi) || 0,
      earnings: Number(p.earnings) || 0,
      expenses: Number(p.expenses) || 0,
      status: p.status,
      health: p.health,
    }));

    const topInvestor =
      topPartnersRows.length > 0
        ? {
            name: topPartnersRows[0].name,
            role: 'Principal Partner',
            shares: Number(topPartnersRows[0].shares),
          }
        : { name: 'N/A', role: 'N/A', shares: 0 };

    const totalSectorVal = sectors.reduce((sum, s) => sum + Number(s.value), 0) || 1;

    return {
      totalMembers: Number(stats.totalMembers),
      investedCapital: Number(stats.investedCapital),
      totalShares: Number(stats.totalShares),
      totalDeposits: Number(stats.totalDeposits),
      yieldIndex: Number(stats.yieldIndex),
      fundStability: Number(stats.fundStability),
      lastUpdated: stats.lastUpdated ?? null,
      trendData: trends.map((t: any) => ({
        month: t.month,
        deposit: Number(t.deposit ?? t.inflow ?? 0),
        inflow: Number(t.inflow),
        outflow: Number(t.outflow),
        netProfit: Number(t.inflow) - Number(t.outflow),
      })),
      sectorDiversification: sectors.map((s) => ({
        category: s.category,
        value: Number(s.value),
        percentage: Number(((Number(s.value) / totalSectorVal) * 100).toFixed(1)),
      })),
      topPartners: topPartnersRows.map((p) => ({
        name: p.name,
        shares: Number(p.shares),
        totalContributed: Number(p.totalContributed || 0),
        performanceScore: Number(p.performanceScore || 100),
      })),
      maxShares: topPartnersRows.length > 0 ? Number(topPartnersRows[0].shares) : 100,
      topProjects: formattedTopProjects,
      topInvestor,
      governance: {
        totalMeetings: Number(govStats[0]?.total_meetings || 0),
        attendanceRate: Number(govStats[0]?.attendance_rate || 100),
        onTimeDepositRate: Number(govStats[0]?.deposit_rate || 100),
        activePenaltiesCount: Number(govStats[0]?.active_penalties || 0),
      },
    };
  }, STATS_CACHE_TTL);
}

/**
 * Heavy aggregation that recalculates all statistics from source tables.
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

      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];

      // Ensure deposit column exists in global_stats_trends table
      try {
        await pg`ALTER TABLE global_stats_trends ADD COLUMN IF NOT EXISTS deposit numeric(15, 2) DEFAULT '0'`;
      } catch {
        // Ignore column check failures if permissions or schema is managed
      }

      // Run all aggregations in parallel
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
        govStats,
      ] = await Promise.all([
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

        // 4. Sum of deposits (status Success or Completed)
        pg`
          SELECT COALESCE(SUM(amount), 0) AS total_deposits
          FROM transactions
          WHERE type = 'Deposit'
            AND status IN ('Completed', 'Success')
            AND is_deleted = false
        `,

        // 5. Complete chronological monthly trend (up to 36 months)
        pg`
          SELECT
            EXTRACT(YEAR  FROM date)::int  AS year,
            EXTRACT(MONTH FROM date)::int  AS month,
            COALESCE(SUM(CASE WHEN type = 'Deposit' THEN amount ELSE 0 END), 0) AS deposit,
            COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning') THEN amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Investment', 'Dividend') THEN amount ELSE 0 END), 0) AS outflow
          FROM transactions
          WHERE status IN ('Completed', 'Success')
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

        // 7. Top partners by shares
        db
          .select({
            name: members.name,
            shares: members.shares,
            totalContributed: members.totalContributed,
            performanceScore: members.performanceScore,
          })
          .from(members)
          .where(eq(members.status, 'active'))
          .orderBy(sql`shares DESC`)
          .limit(6),

        // 8. Top projects by ROI
        db
          .select({
            title: projects.title,
            category: projects.category,
            roi: projects.expectedRoi,
            earnings: projects.totalEarnings,
            expenses: projects.totalExpenses,
            status: projects.status,
            health: projects.health,
          })
          .from(projects)
          .orderBy(sql`expected_roi DESC`)
          .limit(6),

        // 9. Total inflows vs outflows
        pg`
          SELECT
            COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning') THEN amount ELSE 0 END), 0) AS total_inflow,
            COALESCE(SUM(CASE WHEN type IN ('Withdrawal', 'Expense', 'Investment', 'Dividend') THEN amount ELSE 0 END), 0) AS total_outflow
          FROM transactions
          WHERE status IN ('Completed', 'Success')
            AND is_deleted = false
        `,

        // 10. Governance & Assembly Metrics
        pg`
          SELECT
            (SELECT COUNT(*) FROM meetings) AS total_meetings,
            (SELECT COALESCE(ROUND(AVG(CASE WHEN attendance_status = 'PRESENT' THEN 100.0 WHEN attendance_status = 'EXCUSED' THEN 80.0 ELSE 0 END), 1), 100) FROM meeting_attendees) AS attendance_rate,
            (SELECT COALESCE(ROUND(AVG(CASE WHEN deposit_status = 'PAID_ON_TIME' THEN 100.0 WHEN deposit_status = 'PAID_LATE' THEN 70.0 ELSE 0 END), 1), 100) FROM meeting_attendees) AS deposit_rate,
            (SELECT COUNT(*) FROM member_penalties WHERE status = 'ACTIVE') AS active_penalties
        `,
      ]);

      // Process complete historical trend data
      let runningCumulative = 0;
      const trendData: TrendItem[] = trendAggregation.map((row: any) => {
        const dep = Number(row.deposit ?? row.inflow ?? 0);
        const inf = Number(row.inflow);
        const outf = Number(row.outflow);
        const net = inf - outf;
        runningCumulative += net;
        const shortYear = String(row.year).slice(2);
        const monthLabel = `${monthNames[row.month - 1]} '${shortYear}`;
        return {
          month: monthLabel,
          deposit: dep,
          inflow: inf,
          outflow: outf,
          netProfit: net,
          cumulativeBalance: runningCumulative,
        };
      });

      const totalMembers = Number(totalMembersResult[0]?.count ?? 0);
      const investedCapital = Number(projectAggregation[0]?.invested_capital ?? 0);
      const totalShares = Number(memberAggregation[0]?.total_shares ?? 0);
      const totalDeposits = Math.max(Number(transactionAggregation[0]?.total_deposits ?? 0), 1);
      const avgYield = Number(projectAggregation[0]?.avg_yield ?? 0);
      const totalInflow = Number(cashFlowParams[0]?.total_inflow ?? 0);
      const totalOutflow = Number(cashFlowParams[0]?.total_outflow ?? 0);

      const totalLiquidCash = Math.max(0, totalInflow - totalOutflow);
      const totalAssets = investedCapital + totalLiquidCash;
      const fundStability = Number(Math.min(100, (totalAssets / totalDeposits) * 100).toFixed(1));

      const formattedTopProjects = topProjectsRows.map((p) => ({
        title: p.title,
        category: p.category,
        roi: Number(p.roi) || 0,
        earnings: Number(p.earnings) || 0,
        expenses: Number(p.expenses) || 0,
        status: p.status,
        health: p.health,
      }));

      const topInvestor =
        topPartnersRows.length > 0
          ? {
              name: topPartnersRows[0].name,
              role: 'Principal Partner',
              shares: Number(topPartnersRows[0].shares),
            }
          : { name: 'N/A', role: 'N/A', shares: 0 };

      const maxShares = topPartnersRows.length > 0 ? Number(topPartnersRows[0].shares) : 100;

      const totalSectorVal = sectorDiversificationRows.reduce((sum: number, s: any) => sum + Number(s.value), 0) || 1;
      const sectorDiversification = sectorDiversificationRows.map((s: any) => ({
        category: s.category,
        value: Number(s.value),
        percentage: Number(((Number(s.value) / totalSectorVal) * 100).toFixed(1)),
      }));

      const governance: GovernanceMetrics = {
        totalMeetings: Number(govStats[0]?.total_meetings || 0),
        attendanceRate: Number(govStats[0]?.attendance_rate || 100),
        onTimeDepositRate: Number(govStats[0]?.deposit_rate || 100),
        activePenaltiesCount: Number(govStats[0]?.active_penalties || 0),
      };

      // Upsert in database
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: globalStats.id }).from(globalStats).limit(1);
        if (existing) {
          await tx.delete(globalStatsTrends).where(eq(globalStatsTrends.globalStatsId, existing.id));
          await tx.delete(globalStatsSectors).where(eq(globalStatsSectors.globalStatsId, existing.id));
          await tx.delete(globalStats).where(eq(globalStats.id, existing.id));
        }

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

        if (trendData.length > 0) {
          await tx.insert(globalStatsTrends).values(
            trendData.map((t) => ({
              globalStatsId: newStats.id,
              month: t.month,
              deposit: String(t.deposit ?? t.inflow ?? 0),
              inflow: String(t.inflow),
              outflow: String(t.outflow),
            })),
          );
        }

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
          topPartners: topPartnersRows.map((p) => ({
            name: p.name,
            shares: Number(p.shares),
            totalContributed: Number(p.totalContributed || 0),
            performanceScore: Number(p.performanceScore || 100),
          })),
          maxShares,
          topProjects: formattedTopProjects,
          topInvestor,
          governance,
          lastUpdated: new Date(),
        };
      });

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
