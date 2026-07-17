import { getDb } from '../../config/database.js';
import {
  transactions,
  members,
  projects,
  funds,
} from '../../db/schema/index.js';
import { eq, and, desc, asc, sql, gte, lte, sum } from 'drizzle-orm';

/**
 * Generate a report by type.
 * For now returns JSON data; PDF/Excel library integration can be added later.
 */
export async function generateReport(
  type: string,
  format: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const db = getDb();
  const baseWhere = eq(transactions.isDeleted, false);

  switch (type) {
    // ─────────────────────────────────────────────────────────────
    case 'Comprehensive Master Ledger': {
      const data = await db
        .select()
        .from(transactions)
        .where(baseWhere)
        .orderBy(desc(transactions.date))
        .limit(2000);

      return { reportType: type, format, generatedAt: new Date().toISOString(), rowCount: data.length, data };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Specific Ledger': {
      const projectId = params.projectId as string | undefined;
      if (!projectId) {
        return { reportType: type, format, error: 'projectId is required' };
      }

      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.projectId, projectId)))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [projectInfo] = await db
        .select({ title: projects.title, category: projects.category })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      return { reportType: type, format, project: projectInfo ?? null, rowCount: data.length, data };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Member Specific Ledger': {
      const memberId = params.memberId as string | undefined;
      if (!memberId) {
        return { reportType: type, format, error: 'memberId is required' };
      }

      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.memberId, memberId)))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [memberInfo] = await db
        .select({ name: members.name, memberId: members.memberId })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      return { reportType: type, format, member: memberInfo ?? null, rowCount: data.length, data };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Fund Specific Ledger': {
      const fundId = params.fundId as string | undefined;
      if (!fundId) {
        return { reportType: type, format, error: 'fundId is required' };
      }

      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.fundId, fundId)))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [fundInfo] = await db
        .select({ name: funds.name, type: funds.type })
        .from(funds)
        .where(eq(funds.id, fundId))
        .limit(1);

      return { reportType: type, format, fund: fundInfo ?? null, rowCount: data.length, data };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Stakeholder Statement': {
      const memberId = params.memberId as string | undefined;

      const memberQuery = memberId
        ? db
            .select()
            .from(members)
            .where(eq(members.id, memberId))
            .orderBy(asc(members.name))
            .limit(2000)
        : db.select().from(members).where(eq(members.status, 'active')).orderBy(asc(members.name)).limit(2000);

      const stakeholderData = await memberQuery;

      return { reportType: type, format, generatedAt: new Date().toISOString(), rowCount: stakeholderData.length, data: stakeholderData };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Funds Summary': {
      const fundData = await db
        .select()
        .from(funds)
        .where(eq(funds.status, 'ACTIVE'))
        .orderBy(asc(funds.name));

      return { reportType: type, format, generatedAt: new Date().toISOString(), rowCount: fundData.length, data: fundData };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Dividend Report': {
      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Dividend')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Dividend')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalDividends: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Member Contribution': {
      const memberId = params.memberId as string | undefined;

      const where = memberId
        ? and(baseWhere, eq(transactions.type, 'Contribution'), eq(transactions.memberId, memberId))
        : and(baseWhere, eq(transactions.type, 'Contribution'));

      const data = await db
        .select()
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(where);

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalContributions: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Member Deposit History': {
      const memberId = params.memberId as string | undefined;
      if (!memberId) {
        return { reportType: type, format, error: 'memberId is required' };
      }

      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.memberId, memberId), eq(transactions.type, 'Deposit')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.memberId, memberId), eq(transactions.type, 'Deposit')));

      const [memberInfo] = await db
        .select({ name: members.name, memberId: members.memberId })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      return {
        reportType: type,
        format,
        member: memberInfo ?? null,
        totalDeposits: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Revenue Analytics': {
      const startDate = (params.startDate as string) ?? undefined;
      const endDate = (params.endDate as string) ?? undefined;

      const dateConditions = [];
      if (startDate) dateConditions.push(gte(transactions.date, new Date(startDate)));
      if (endDate) dateConditions.push(lte(transactions.date, new Date(endDate)));

      const whereRevenue = and(
        baseWhere,
        sql`${transactions.type} IN ('Deposit', 'Earning', 'Investment', 'Dividend')`,
        ...dateConditions,
      );

      const data = await db
        .select()
        .from(transactions)
        .where(whereRevenue)
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(whereRevenue);

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalRevenue: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Interest Accruals': {
      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Interest')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Interest')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalInterest: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Earnings Ledger': {
      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Earning')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Earning')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalEarnings: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Expense Audit': {
      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Expense')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Expense')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalExpenses: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Expense Audit': {
      const projectId = params.projectId as string | undefined;
      if (!projectId) {
        return { reportType: type, format, error: 'projectId is required' };
      }

      const data = await db
        .select()
        .from(transactions)
        .where(and(baseWhere, eq(transactions.projectId, projectId), eq(transactions.type, 'Expense')))
        .orderBy(desc(transactions.date))
        .limit(2000);

      const [projectInfo] = await db
        .select({ title: projects.title, category: projects.category })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.projectId, projectId), eq(transactions.type, 'Expense')));

      return {
        reportType: type,
        format,
        project: projectInfo ?? null,
        totalExpenses: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Performance': {
      const projectData = await db
        .select({
          id: projects.id,
          title: projects.title,
          category: projects.category,
          status: projects.status,
          health: projects.health,
          initialInvestment: projects.initialInvestment,
          budget: projects.budget,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          expectedRoi: projects.expectedRoi,
          startDate: projects.startDate,
          completionDate: projects.completionDate,
          currentFundBalance: projects.currentFundBalance,
        })
        .from(projects)
        .orderBy(asc(projects.title))
        .limit(500);

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        rowCount: projectData.length,
        data: projectData.map((p) => ({
          ...p,
          initialInvestment: Number(p.initialInvestment),
          budget: Number(p.budget),
          totalEarnings: Number(p.totalEarnings),
          totalExpenses: Number(p.totalExpenses),
          expectedRoi: Number(p.expectedRoi),
          currentFundBalance: Number(p.currentFundBalance),
        })),
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'ROI Analysis': {
      const projectData = await db
        .select({
          id: projects.id,
          title: projects.title,
          category: projects.category,
          initialInvestment: projects.initialInvestment,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          expectedRoi: projects.expectedRoi,
          status: projects.status,
        })
        .from(projects)
        .orderBy(desc(projects.expectedRoi))
        .limit(500);

      const roiData = projectData.map((p) => {
        const investment = Number(p.initialInvestment) || 1;
        const earnings = Number(p.totalEarnings);
        const expenses = Number(p.totalExpenses);
        const netProfit = earnings - expenses;
        const actualRoi = (netProfit / investment) * 100;

        return {
          id: p.id,
          title: p.title,
          category: p.category,
          initialInvestment: Number(p.initialInvestment),
          totalEarnings: earnings,
          totalExpenses: expenses,
          netProfit,
          expectedRoi: Number(p.expectedRoi),
          actualRoi: Number(actualRoi.toFixed(2)),
          variance: Number((Number(p.expectedRoi) - actualRoi).toFixed(2)),
          status: p.status,
        };
      });

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        rowCount: roiData.length,
        data: roiData,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Growth Matrix': {
      const projectData = await db
        .select({
          id: projects.id,
          title: projects.title,
          category: projects.category,
          status: projects.status,
          initialInvestment: projects.initialInvestment,
          currentFundBalance: projects.currentFundBalance,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          startDate: projects.startDate,
          completionDate: projects.completionDate,
          totalShares: projects.totalShares,
          expectedRoi: projects.expectedRoi,
        })
        .from(projects)
        .orderBy(asc(projects.title))
        .limit(500);

      const growthData = projectData.map((p) => {
        const investment = Number(p.initialInvestment) || 1;
        const earnings = Number(p.totalEarnings);
        const expenses = Number(p.totalExpenses);
        const balance = Number(p.currentFundBalance);
        const growth = ((balance - investment) / investment) * 100;

        return {
          id: p.id,
          title: p.title,
          category: p.category,
          status: p.status,
          initialInvestment: Number(p.initialInvestment),
          currentFundBalance: balance,
          totalEarnings: earnings,
          totalExpenses: expenses,
          netPosition: earnings - expenses,
          growthPercentage: Number(growth.toFixed(2)),
          totalShares: p.totalShares,
          expectedRoi: Number(p.expectedRoi),
          startDate: p.startDate,
          completionDate: p.completionDate,
        };
      });

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        rowCount: growthData.length,
        data: growthData,
      };
    }

    // ─────────────────────────────────────────────────────────────
    default:
      return { reportType: type, format, error: `Unknown report type: ${type}` };
  }
}

/**
 * Export generic data as a structured report.
 * Accepts columns and rows from the request body and returns them organized.
 */
export async function exportGeneric(data: {
  columns: string[];
  rows: unknown[][];
}): Promise<unknown> {
  return {
    type: 'generic',
    format: 'json',
    columns: data.columns,
    rows: data.rows,
    generatedAt: new Date().toISOString(),
  };
}
