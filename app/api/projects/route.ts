import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, funds, transactions, systemSettings } from '@/db/schema/index';
import { eq, and, desc, ilike, or, count, type SQL } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { projectCreateSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from './_helpers';
import { toCents, fromCents } from '@/lib/money';
import { investProjectCapital } from '@/lib/project-capital';
import crypto from 'node:crypto';
import { ValidationError, ForbiddenError, readJsonBody } from '@/lib/utils/errors';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';

export const dynamic = 'force-dynamic';
// A multi-shareholder creation locks, validates and writes in a handful of
// grouped statements, but the transaction still spans several round-trips —
// keep headroom over the 10s serverless default.
export const maxDuration = 60;

// Page size is bounded; defaults high so existing "fetch all" callers
// (dashboard, projects page) keep working while still returning an honest total.
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

/** Tenant-scoped project list with optional status/fund/search filters. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectContext(request);
    if ('error' in ctx) return ctx.error;
    const { tenantId } = ctx;

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;
    const fundId = url.searchParams.get('fundId') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE),
    );

    const conditions: SQL[] = [eq(projects.tenantId, tenantId)];
    if (status) conditions.push(eq(projects.status, status));
    if (fundId) conditions.push(eq(projects.linkedFundId, fundId));
    if (search) {
      const like = `%${search}%`;
      const searchCondition = or(
        ilike(projects.title, like),
        ilike(projects.category, like),
        ilike(projects.description, like),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    const where = and(...conditions);

    const db = getDb();
    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(projects)
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(projects).where(where),
    ]);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { page, pageSize, total: totalRow[0]?.total ?? 0 },
    });
  } catch (err: unknown) {
    console.error('[PROJECTS LIST ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to fetch projects' },
      { status: e.statusCode || 500 },
    );
  }
}

/** 
 * Create a project with Option A shareholder deposit deduction, fund creation or linking,
 * and ledger entries in an atomic transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const body = await readJsonBody(request);
    const parsed = projectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: zodMessage(parsed.error) },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const db = getDb();

    const createdProject = await db.transaction(async (tx) => {
      const now = new Date();
      if ((data.shareholders || []).length > 0) {
        await assertFiscalPeriodOpen(tx, tenantId, now);
      }

      // 1. Resolve tenant share value from system_settings
      const [settingRow] = await tx
        .select({ shareValueBdt: systemSettings.shareValueBdt })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1);
      const shareValue = Number(settingRow?.shareValueBdt || 1000);

      // 2. Fund management: create dedicated new fund or link existing fund
      let targetFundId: string | null = null;
      if (data.createNewFund) {
        const fundName = data.newFundName?.trim() || `${data.title} Fund`;
        const [newFund] = await tx
          .insert(funds)
          .values({
            tenantId,
            name: fundName,
            type: 'PROJECT',
            balance: '0.00',
            description: `Dedicated fund for project: ${data.title}`,
          })
          .returning();
        if (!newFund) {
          throw new Error('Dedicated fund creation returned no row');
        }
        targetFundId = newFund.id;
      } else if (data.linkedFundId) {
        const [existingFund] = await tx
          .select()
          .from(funds)
          .where(and(eq(funds.id, data.linkedFundId), eq(funds.tenantId, tenantId)))
          .for('update')
          .limit(1);
        if (!existingFund) {
          throw new ForbiddenError('Linked fund does not belong to this tenant');
        }
        targetFundId = existingFund.id;
      }

      // 3. Invested capital is drawn out of member deposit equity and out of the
      // named source deposit funds, then credited to the project's fund. This is
      // the shared ledger primitive used by create, edit and delete so the three
      // money paths cannot drift apart.
      const rawShareholders = data.shareholders || [];

      // Funding guard (§12): an initial investment must be backed by member
      // deposits. Checked before any write — capital with no shareholder source
      // would otherwise be money created from nowhere.
      if (data.initialInvestment > 0 && rawShareholders.length === 0) {
        throw new ValidationError(
          'Initial investment must be funded from member deposits: add at least one shareholder whose invested capital covers it.',
        );
      }

      const capital = await investProjectCapital(tx, {
        tenantId,
        shareValue,
        destinationFundId: targetFundId,
        budgetCents: toCents(data.budget),
        shareholders: rawShareholders,
        now,
      });

      const processedShareholders = capital.shareholders;
      const totalShares = capital.totalShares;
      // The recorded investment and the starting balance are exactly the capital
      // just deducted from member deposits (§12 double entry).
      const startingProjectBalanceStr = fromCents(capital.totalCents);

      // 5. Insert project record
      const [project] = await tx
        .insert(projects)
        .values({
          tenantId,
          title: data.title,
          category: data.category,
          description: data.description,
          budget: String(data.budget),
          initialInvestment: startingProjectBalanceStr,
          expectedRoi: String(data.expectedRoi),
          totalShares: totalShares,
          status: data.status,
          health: data.health,
          startDate: data.startDate,
          completionDate: data.completionDate ?? null,
          linkedFundId: targetFundId,
          projectFundHandler: data.projectFundHandler ?? null,
          currentFundBalance: startingProjectBalanceStr,
          totalEarnings: '0',
          totalExpenses: '0',
        })
        .returning();

      if (!project) {
        throw new Error('Project creation returned no row');
      }

      // If newly created fund, link project id
      if (data.createNewFund && targetFundId) {
        await tx
          .update(funds)
          .set({ linkedProjectId: project.id })
          .where(eq(funds.id, targetFundId));
      }

      // 6. Record project members
      if (processedShareholders.length > 0) {
        await tx.insert(projectMembers).values(
          processedShareholders.map((ps) => ({
            projectId: project.id,
            memberId: ps.memberId,
            sharesInvested: ps.shares,
            ownershipPercentage: ps.ownershipPercentage,
          })),
        );
      }

      // 7. Insert audit-grade ledger transactions (one multi-row statement)
      if (processedShareholders.length > 0) {
        const runRef = `PRJ-INV-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.insert(transactions).values(
          processedShareholders.map((ps, i) => ({
            tenantId,
            type: 'Project Investment',
            amount: ps.investmentFormatted,
            description: `Equity investment in project: ${project.title} (${ps.shares} ${ps.shares === 1 ? 'share' : 'shares'} @ ${shareValue.toFixed(2)})`,
            category: 'Investment',
            referenceNumber: `${runRef}-${(i + 1).toString().padStart(2, '0')}`,
            date: now,
            submittedDate: now,
            status: 'Completed',
            memberId: ps.memberId,
            projectId: project.id,
            fundId: targetFundId,
            // The fund the cash actually left — lets deletion credit the same
            // fund back instead of leaving the treasury inflated.
            sourceFundId: ps.sourceFundId,
            handlingOfficer: user.name,
            balanceBefore: ps.memberEquityBefore,
            balanceAfter: ps.memberEquityAfter,
            createdBy: user.id,
          })),
        );
      }

      return {
        ...project,
        shareholders: processedShareholders,
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'CREATE_PROJECT',
      resourceType: 'Project',
      resourceId: createdProject.id,
      details: {
        title: createdProject.title,
        budget: createdProject.budget,
        totalShares: createdProject.totalShares,
        shareholderCount: createdProject.shareholders.length,
      },
      // Create flow: after-only — `createdProject` comes from the
      // transaction's inserts (no extra query).
      after: createdProject,
    });

    return NextResponse.json(
      { success: true, data: createdProject, message: 'Project created successfully with shareholder allocations' },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[PROJECTS CREATE ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to create project' },
      { status: e.statusCode || 500 },
    );
  }
}
