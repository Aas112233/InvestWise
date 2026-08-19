import { getDb } from '../../config/database.js';
import {
  transactions,
  members,
  projects,
  funds,
  users,
} from '../../db/schema/index.js';
import { eq, and, desc, asc, sql, gte, lte, sum, aliasedTable } from 'drizzle-orm';

/** Convert array of objects to CSV string with UTF-8 BOM for Excel compatibility. */
export function convertToCsv(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  for (const row of data) {
    const values = headers.map((header) => {
      const val = row[header];
      if (val === null || val === undefined) return '""';
      const str = val instanceof Date ? val.toISOString() : typeof val === 'object' ? JSON.stringify(val) : String(val);
      const escaped = str.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return '\uFEFF' + csvRows.join('\r\n');
}

/**
 * Reusable helper to query transactions joined with human-readable member, fund, project, and authorizer names
 * and computes accurate chronological running balance, debit, and credit.
 */
async function selectResolvedTransactions(whereClause: any, limit = 2000) {
  const db = getDb();
  const authorizer = aliasedTable(users, 'report_authorizer');
  const creator = aliasedTable(users, 'report_creator');

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      createdAt: transactions.createdAt,
      type: transactions.type,
      amount: transactions.amount,
      category: transactions.category,
      description: transactions.description,
      referenceNumber: transactions.referenceNumber,
      partnerName: members.name,
      partnerCode: members.memberId,
      fundName: funds.name,
      projectName: projects.title,
      depositMethod: transactions.depositMethod,
      handlingOfficer: transactions.handlingOfficer,
      authorizedByName: authorizer.name,
      createdByName: creator.name,
      status: transactions.status,
      balanceBefore: transactions.balanceBefore,
      balanceAfter: transactions.balanceAfter,
    })
    .from(transactions)
    .leftJoin(members, eq(transactions.memberId, members.id))
    .leftJoin(funds, eq(transactions.fundId, funds.id))
    .leftJoin(projects, eq(transactions.projectId, projects.id))
    .leftJoin(authorizer, eq(transactions.authorizedBy, authorizer.id))
    .leftJoin(creator, eq(transactions.createdBy, creator.id))
    .where(whereClause)
    .orderBy(asc(transactions.date), asc(transactions.createdAt))
    .limit(limit);

  let cumulativeBalance = 0;

  return rows.map((r) => {
    const amt = Math.abs(Number(r.amount || 0));
    const isInflow = ['Deposit', 'Earning', 'Investment', 'Interest', 'Capital-Injection'].includes(r.type);
    const isOutflow = ['Expense', 'Withdrawal', 'Dividend'].includes(r.type);

    let debit = 0;
    let credit = 0;

    if (isInflow) {
      credit = amt;
      cumulativeBalance += amt;
    } else if (isOutflow) {
      debit = amt;
      cumulativeBalance -= amt;
    } else {
      credit = amt;
      cumulativeBalance += amt;
    }

    const runningBal = r.balanceAfter !== null && r.balanceAfter !== undefined && !Number.isNaN(Number(r.balanceAfter))
      ? Number(r.balanceAfter)
      : Math.round(cumulativeBalance * 100) / 100;

    return {
      date: r.date ? new Date(r.date).toISOString().split('T')[0] : '',
      reference: r.referenceNumber || 'N/A',
      type: r.type,
      partnerName: r.partnerName || 'N/A',
      partnerId: r.partnerCode || 'N/A',
      fundName: r.fundName || 'General Fund',
      projectName: r.projectName || 'N/A',
      category: r.category || 'General',
      description: r.description || '',
      depositMethod: r.depositMethod || 'N/A',
      debit,
      credit,
      amount: amt,
      runningBalance: runningBal,
      handlingOfficer: r.handlingOfficer || 'System',
      authorizedBy: r.authorizedByName || r.handlingOfficer || 'System Admin',
      createdBy: r.createdByName || r.handlingOfficer || 'System',
      status: r.status || 'Completed',
    };
  });
}

/**
 * Generate a report by type.
 * Supports JSON or CSV formatting with resolved entity names and running balances.
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
      const data = await selectResolvedTransactions(baseWhere, 2000);
      const totalInflow = data.reduce((s, r) => s + (r.credit || 0), 0);
      const totalOutflow = data.reduce((s, r) => s + (r.debit || 0), 0);
      const closingBalance = data.length > 0 ? data[data.length - 1].runningBalance : 0;
      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalInflow: Math.round(totalInflow * 100) / 100,
        totalOutflow: Math.round(totalOutflow * 100) / 100,
        netCashFlow: Math.round((totalInflow - totalOutflow) * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        rowCount: data.length,
        data
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Specific Ledger': {
      const projectId = params.projectId as string | undefined;
      if (!projectId) {
        return { reportType: type, format, error: 'projectId is required' };
      }

      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.projectId, projectId)), 2000);

      const [projectInfo] = await db
        .select({ title: projects.title, category: projects.category, currentFundBalance: projects.currentFundBalance })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      const totalInflow = data.reduce((s, r) => s + (r.credit || 0), 0);
      const totalOutflow = data.reduce((s, r) => s + (r.debit || 0), 0);
      const closingBalance = data.length > 0 ? data[data.length - 1].runningBalance : (Number(projectInfo?.currentFundBalance) || 0);

      return {
        reportType: type,
        format,
        projectName: projectInfo?.title ?? 'Unknown Project',
        projectCategory: projectInfo?.category ?? 'General',
        currentBalance: projectInfo?.currentFundBalance ? Number(projectInfo.currentFundBalance) : closingBalance,
        totalInflow: Math.round(totalInflow * 100) / 100,
        totalOutflow: Math.round(totalOutflow * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Member Specific Ledger': {
      const memberId = params.memberId as string | undefined;
      if (!memberId) {
        return { reportType: type, format, error: 'memberId is required' };
      }

      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.memberId, memberId)), 2000);

      const [memberInfo] = await db
        .select({ name: members.name, memberId: members.memberId, shares: members.shares, totalContributed: members.totalContributed })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      const totalInflow = data.reduce((s, r) => s + (r.credit || 0), 0);
      const totalOutflow = data.reduce((s, r) => s + (r.debit || 0), 0);
      const closingBalance = data.length > 0 ? data[data.length - 1].runningBalance : (Number(memberInfo?.totalContributed) || 0);

      return {
        reportType: type,
        format,
        partnerName: memberInfo?.name ?? 'Unknown Partner',
        partnerId: memberInfo?.memberId ?? 'N/A',
        sharesHeld: memberInfo?.shares ?? 0,
        totalContributed: Number(memberInfo?.totalContributed ?? 0),
        totalDeposits: Math.round(totalInflow * 100) / 100,
        totalPayouts: Math.round(totalOutflow * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Fund Specific Ledger': {
      const fundId = params.fundId as string | undefined;
      if (!fundId) {
        return { reportType: type, format, error: 'fundId is required' };
      }

      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.fundId, fundId)), 2000);

      const [fundInfo] = await db
        .select({ name: funds.name, type: funds.type, balance: funds.balance, handlingOfficer: funds.handlingOfficer })
        .from(funds)
        .where(eq(funds.id, fundId))
        .limit(1);

      const totalInflow = data.reduce((s, r) => s + (r.credit || 0), 0);
      const totalOutflow = data.reduce((s, r) => s + (r.debit || 0), 0);
      const closingBalance = data.length > 0 ? data[data.length - 1].runningBalance : (Number(fundInfo?.balance) || 0);

      return {
        reportType: type,
        format,
        fundName: fundInfo?.name ?? 'Unknown Fund',
        fundType: fundInfo?.type ?? 'General',
        currentBalance: fundInfo?.balance ? Number(fundInfo.balance) : closingBalance,
        custodian: fundInfo?.handlingOfficer ?? 'System',
        totalInflow: Math.round(totalInflow * 100) / 100,
        totalOutflow: Math.round(totalOutflow * 100) / 100,
        closingBalance: Math.round(closingBalance * 100) / 100,
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Stakeholder Statement': {
      const memberId = params.memberId as string | undefined;

      const memberQuery = memberId
        ? db
            .select({
              partnerName: members.name,
              partnerId: members.memberId,
              email: members.email,
              phone: members.phone,
              role: members.role,
              shares: members.shares,
              totalContributed: members.totalContributed,
              status: members.status,
            })
            .from(members)
            .where(eq(members.id, memberId))
            .orderBy(asc(members.name))
            .limit(2000)
        : db
            .select({
              partnerName: members.name,
              partnerId: members.memberId,
              email: members.email,
              phone: members.phone,
              role: members.role,
              shares: members.shares,
              totalContributed: members.totalContributed,
              status: members.status,
            })
            .from(members)
            .where(eq(members.status, 'active'))
            .orderBy(asc(members.name))
            .limit(2000);

      const stakeholderRows = await memberQuery;
      const stakeholderData = stakeholderRows.map((m) => ({
        partnerName: m.partnerName,
        partnerId: m.partnerId || 'N/A',
        email: m.email || 'N/A',
        phone: m.phone || 'N/A',
        role: m.role || 'Member',
        shares: m.shares || 0,
        totalContributed: Number(m.totalContributed || 0),
        status: m.status || 'active',
      }));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        rowCount: stakeholderData.length,
        data: stakeholderData,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Funds Summary': {
      const fundRows = await db
        .select({
          fundName: funds.name,
          fundType: funds.type,
          balance: funds.balance,
          currency: funds.currency,
          handlingOfficer: funds.handlingOfficer,
          accountNumber: funds.accountNumber,
          status: funds.status,
        })
        .from(funds)
        .where(eq(funds.status, 'ACTIVE'))
        .orderBy(asc(funds.name));

      const fundData = fundRows.map((f) => ({
        fundName: f.fundName,
        fundType: f.fundType,
        balance: Number(f.balance || 0),
        currency: f.currency || 'BDT',
        handlingOfficer: f.handlingOfficer || 'System',
        accountNumber: f.accountNumber || 'N/A',
        status: f.status || 'ACTIVE',
      }));

      const totalBalance = fundData.reduce((sum, f) => sum + f.balance, 0);

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalLiquidity: totalBalance,
        activeFundsCount: fundData.length,
        rowCount: fundData.length,
        data: fundData,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Dividend Report': {
      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.type, 'Dividend')), 2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Dividend')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalDividendsDistributed: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Member Contribution': {
      const memberId = params.memberId as string | undefined;
      const where = memberId
        ? and(baseWhere, eq(transactions.type, 'Deposit'), eq(transactions.memberId, memberId))
        : and(baseWhere, eq(transactions.type, 'Deposit'));

      const data = await selectResolvedTransactions(where, 2000);

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

      const where = and(baseWhere, eq(transactions.memberId, memberId), eq(transactions.type, 'Deposit'));
      const data = await selectResolvedTransactions(where, 2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(where);

      const [memberInfo] = await db
        .select({ name: members.name, memberId: members.memberId, shares: members.shares })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      return {
        reportType: type,
        format,
        partnerName: memberInfo?.name ?? 'Unknown Partner',
        partnerId: memberInfo?.memberId ?? 'N/A',
        sharesHeld: memberInfo?.shares ?? 0,
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

      const data = await selectResolvedTransactions(whereRevenue, 2000);

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
      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.type, 'Interest')), 2000);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(and(baseWhere, eq(transactions.type, 'Interest')));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        totalInterestAccrued: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Earnings Ledger': {
      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.type, 'Earning')), 2000);

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
      const data = await selectResolvedTransactions(and(baseWhere, eq(transactions.type, 'Expense')), 2000);

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

      const where = and(baseWhere, eq(transactions.projectId, projectId), eq(transactions.type, 'Expense'));
      const data = await selectResolvedTransactions(where, 2000);

      const [projectInfo] = await db
        .select({ title: projects.title, category: projects.category })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      const [aggregate] = await db
        .select({ total: sum(transactions.amount) })
        .from(transactions)
        .where(where);

      return {
        reportType: type,
        format,
        projectName: projectInfo?.title ?? 'Unknown Project',
        projectCategory: projectInfo?.category ?? 'General',
        totalProjectExpenses: Number(aggregate?.total ?? 0),
        rowCount: data.length,
        data,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'Project Performance': {
      const projectData = await db
        .select({
          projectName: projects.title,
          category: projects.category,
          status: projects.status,
          health: projects.health,
          initialInvestment: projects.initialInvestment,
          budget: projects.budget,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          currentFundBalance: projects.currentFundBalance,
          expectedRoi: projects.expectedRoi,
          startDate: projects.startDate,
          completionDate: projects.completionDate,
        })
        .from(projects)
        .orderBy(asc(projects.title))
        .limit(500);

      const mapped = projectData.map((p) => ({
        projectName: p.projectName,
        category: p.category,
        status: p.status,
        health: p.health,
        budget: Number(p.budget || 0),
        initialInvestment: Number(p.initialInvestment || 0),
        totalEarnings: Number(p.totalEarnings || 0),
        totalExpenses: Number(p.totalExpenses || 0),
        currentFundBalance: Number(p.currentFundBalance || 0),
        expectedRoi: Number(p.expectedRoi || 0),
        startDate: p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : 'N/A',
        completionDate: p.completionDate ? new Date(p.completionDate).toISOString().split('T')[0] : 'Ongoing',
      }));

      return {
        reportType: type,
        format,
        generatedAt: new Date().toISOString(),
        rowCount: mapped.length,
        data: mapped,
      };
    }

    // ─────────────────────────────────────────────────────────────
    case 'ROI Analysis': {
      const projectData = await db
        .select({
          projectName: projects.title,
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
        const earnings = Number(p.totalEarnings || 0);
        const expenses = Number(p.totalExpenses || 0);
        const netProfit = earnings - expenses;
        const actualRoi = (netProfit / investment) * 100;

        return {
          projectName: p.projectName,
          category: p.category,
          initialInvestment: Number(p.initialInvestment || 0),
          totalEarnings: earnings,
          totalExpenses: expenses,
          netProfit,
          expectedRoi: Number(p.expectedRoi || 0),
          actualRoi: Number(actualRoi.toFixed(2)),
          variance: Number((Number(p.expectedRoi || 0) - actualRoi).toFixed(2)),
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
          projectName: projects.title,
          category: projects.category,
          status: projects.status,
          initialInvestment: projects.initialInvestment,
          currentFundBalance: projects.currentFundBalance,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          totalShares: projects.totalShares,
          expectedRoi: projects.expectedRoi,
          startDate: projects.startDate,
          completionDate: projects.completionDate,
        })
        .from(projects)
        .orderBy(asc(projects.title))
        .limit(500);

      const growthData = projectData.map((p) => {
        const investment = Number(p.initialInvestment) || 1;
        const earnings = Number(p.totalEarnings || 0);
        const expenses = Number(p.totalExpenses || 0);
        const balance = Number(p.currentFundBalance || 0);
        const growth = ((balance - investment) / investment) * 100;

        return {
          projectName: p.projectName,
          category: p.category,
          status: p.status,
          initialInvestment: Number(p.initialInvestment || 0),
          currentFundBalance: balance,
          totalEarnings: earnings,
          totalExpenses: expenses,
          netPosition: earnings - expenses,
          growthPercentage: Number(growth.toFixed(2)),
          totalShares: p.totalShares || 0,
          expectedRoi: Number(p.expectedRoi || 0),
          startDate: p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : 'N/A',
          completionDate: p.completionDate ? new Date(p.completionDate).toISOString().split('T')[0] : 'Ongoing',
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
