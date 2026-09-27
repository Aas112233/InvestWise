import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import {
  transactions,
  members,
  projects,
  funds,
  users,
  memberPenalties,
  meetings,
} from '@/db/schema/index';
import { eq, and, desc, asc, sql, gte, lte, aliasedTable } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

/**
 * Convert array of objects to CSV string with UTF-8 BOM for Excel compatibility (Rule §10).
 */
function convertToCsv(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0] || {});
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { type } = await params;
    const reportType = decodeURIComponent(type);

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const memberId = searchParams.get('memberId');
    const projectId = searchParams.get('projectId');
    const fundId = searchParams.get('fundId');

    const db = getDb();
    let exportData: Record<string, unknown>[] = [];
    let filenamePrefix = reportType.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    // 1. Comprehensive Master Ledger Report
    if (reportType.toLowerCase().includes('ledger')) {
      const authorizer = aliasedTable(users, 'report_authorizer');
      const conditions: ReturnType<typeof sql>[] = [];

      if (startDate) conditions.push(gte(transactions.date, new Date(startDate)));
      if (endDate) conditions.push(lte(transactions.date, new Date(endDate)));
      if (memberId) conditions.push(eq(transactions.memberId, memberId));
      if (projectId) conditions.push(eq(transactions.projectId, projectId));
      if (fundId) conditions.push(eq(transactions.fundId, fundId));

      const rows = await db
        .select({
          transactionId: transactions.referenceNumber,
          date: transactions.date,
          type: transactions.type,
          category: transactions.category,
          amount: transactions.amount,
          member: members.name,
          fund: funds.name,
          project: projects.title,
          description: transactions.description,
          status: transactions.status,
        })
        .from(transactions)
        .leftJoin(members, eq(transactions.memberId, members.id))
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .leftJoin(projects, eq(transactions.projectId, projects.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transactions.date))
        .limit(2000);

      exportData = rows.map((r) => ({
        'Reference #': r.transactionId || 'N/A',
        'Date': r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
        'Type': r.type,
        'Category': r.category || 'General',
        'Amount': r.amount,
        'Member': r.member || 'N/A',
        'Fund': r.fund || 'N/A',
        'Project': r.project || 'N/A',
        'Status': r.status,
        'Description': r.description || '',
      }));
    }
    // 2. Member Contributions & Deposits Report
    else if (reportType.toLowerCase().includes('deposit') || reportType.toLowerCase().includes('member')) {
      const rows = await db
        .select({
          memberCode: members.memberId,
          name: members.name,
          email: members.email,
          phone: members.phone,
          shares: members.shares,
          totalContributed: members.totalContributed,
          warningCount: members.warningCount,
          status: members.status,
          joinDate: members.createdAt,
        })
        .from(members)
        .orderBy(asc(members.name));

      exportData = rows.map((m) => ({
        'Member ID': m.memberCode,
        'Name': m.name,
        'Email': m.email || '',
        'Phone': m.phone || '',
        'Shares Count': m.shares,
        'Total Contributed': m.totalContributed,
        'Warnings': m.warningCount || 0,
        'Status': m.status,
        'Join Date': m.joinDate ? new Date(m.joinDate).toISOString().slice(0, 10) : '',
      }));
    }
    // 3. Projects Portfolio Report
    else if (reportType.toLowerCase().includes('project')) {
      const rows = await db
        .select({
          title: projects.title,
          category: projects.category,
          status: projects.status,
          health: projects.health,
          initialInvestment: projects.initialInvestment,
          budget: projects.budget,
          currentFundBalance: projects.currentFundBalance,
          totalEarnings: projects.totalEarnings,
          totalExpenses: projects.totalExpenses,
          expectedRoi: projects.expectedRoi,
          startDate: projects.startDate,
          completionDate: projects.completionDate,
        })
        .from(projects)
        .orderBy(desc(projects.createdAt));

      exportData = rows.map((p) => ({
        'Project Title': p.title,
        'Category': p.category,
        'Status': p.status,
        'Health': p.health,
        'Initial Capital': p.initialInvestment,
        'Budget': p.budget,
        'Fund Balance': p.currentFundBalance,
        'Total Earnings': p.totalEarnings,
        'Total Expenses': p.totalExpenses,
        'Expected ROI (%)': p.expectedRoi,
        'Start Date': p.startDate,
        'Completion Date': p.completionDate || 'Ongoing',
      }));
    }
    // 4. Governance & Penalties Report
    else if (reportType.toLowerCase().includes('governance') || reportType.toLowerCase().includes('penalt')) {
      const rows = await db
        .select({
          penaltyId: memberPenalties.id,
          member: members.name,
          memberCode: members.memberId,
          tier: memberPenalties.tier,
          title: memberPenalties.title,
          type: memberPenalties.type,
          deduction: memberPenalties.calculatedDeduction,
          status: memberPenalties.status,
          reason: memberPenalties.reason,
          issuedAt: memberPenalties.issuedAt,
          waivedAt: memberPenalties.waivedAt,
          waiveReason: memberPenalties.waiveReason,
        })
        .from(memberPenalties)
        .leftJoin(members, eq(memberPenalties.memberId, members.id))
        .orderBy(desc(memberPenalties.createdAt));

      exportData = rows.map((pen) => ({
        'Member': pen.member || 'N/A',
        'Member Code': pen.memberCode || 'N/A',
        'Tier': `Tier ${pen.tier}`,
        'Title': pen.title,
        'Type': pen.type,
        'Deduction': pen.deduction || '0.00',
        'Status': pen.status,
        'Reason': pen.reason,
        'Issued Date': pen.issuedAt ? new Date(pen.issuedAt).toISOString().slice(0, 10) : '',
        'Waived Date': pen.waivedAt ? new Date(pen.waivedAt).toISOString().slice(0, 10) : 'N/A',
        'Waive Reason': pen.waiveReason || '',
      }));
    }
    // Default fallback
    else {
      exportData = [
        {
          Report: reportType,
          GeneratedAt: new Date().toISOString(),
          Status: 'Active',
          Note: 'Export generated with active multi-tenant ledger synchronization.',
        },
      ];
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'GENERATE_REPORT',
      resourceType: 'Report',
      details: { reportType, format, rows: exportData.length },
    });

    const csvContent = convertToCsv(exportData);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `${filenamePrefix}_${dateStamp}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('[REPORT GENERATE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Report generation failed' },
      { status: err.statusCode || 500 }
    );
  }
}
