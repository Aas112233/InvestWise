import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, funds, transactions, systemSettings } from '@/db/schema/index';
import { eq, and, desc, ilike, or, count, type SQL } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { projectCreateSchema, normalizeProjectMemberPercent } from '@/lib/utils/validation';
import { isAllowedCategory, categoryRejectionMessage } from '@/lib/categories';
import { getCategoryContext } from '@/lib/categories-db';
import { requireProjectContext, zodMessage } from './_helpers';
import { parseProjectType, isProjectType, type ProjectType } from '@/lib/distribution-rules';
import { toCents, fromCents } from '@/lib/money';
import { investProjectCapital } from '@/lib/project-capital';
import crypto from 'node:crypto';
import { ValidationError, ForbiddenError, ConflictError, readJsonBody } from '@/lib/utils/errors';
import { generateProjectCode, isProjectCodeClash } from '@/lib/project-code';
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
    // Type filter (migration 0032) — the Extra Investor-only project picker on the
    // member form. An unknown value is a 400 rather than "ignored", because a
    // silently dropped filter would offer club projects to a Project Member
    // binding, which is exactly what the filter exists to prevent.
    const rawType = url.searchParams.get('projectType');
    let projectTypeFilter: ProjectType | undefined;
    if (rawType) {
      if (!isProjectType(rawType)) {
        return NextResponse.json(
          {
            success: false,
            message: `[Field 'projectType', Code: INVALID_PROJECT_TYPE] Unknown project type: ${rawType}`,
          },
          { status: 400 },
        );
      }
      projectTypeFilter = rawType;
    }
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get('page')) || 1)); // page bounded: a huge `page` is an OFFSET walk Postgres still does
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE),
    );

    const conditions: SQL[] = [eq(projects.tenantId, tenantId)];
    if (status) conditions.push(eq(projects.status, status));
    if (fundId) conditions.push(eq(projects.linkedFundId, fundId));
    if (projectTypeFilter) conditions.push(eq(projects.projectType, projectTypeFilter));
    if (search) {
      const like = `%${search}%`;
      const searchCondition = or(
        ilike(projects.projectCode, like), // "prj-3" finds PRJ-0003 (member-code behavior)
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
    return apiError(e, 'Failed to fetch projects');
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

    // Category must be one the tenant configured in Settings (or one historical
    // projects already carry, so removing a sector never invalidates old rows).
    // projects.category is a plain varchar, so nothing else constrained it.
    {
      const { configured, history } = await getCategoryContext(tenantId, 'project');
      if (!isAllowedCategory(data.category, configured, history)) {
        throw new ValidationError(categoryRejectionMessage('category', configured));
      }
    }

    // Per-project 'Project Level Member' contract (migrations 0030 → 0032): the
    // percent contract is owned by lib/distribution-rules. Its old save-time Σ
    // guard against the CLUB rules is gone on purpose (plan D8): a Project Level
    // Member percentage no longer competes with the club categories — club
    // projects cannot have PMs at all, and an Extra Investor project splits its
    // remainder by share number, so the two sets are never added together.
    const projectMemberPercent = normalizeProjectMemberPercent(data.projectMemberPercent);
    // Absent means a club project (the migration 0032 default): every caller that
    // predates project types creates exactly that, unchanged.
    const projectType = parseProjectType(data.projectType);

    // Sequential PRJ-XXXX code (lib/project-code.ts), member-style. A
    // concurrent create can read the same MAX+1: the loser's transaction
    // rolls back ATOMICALLY (fund insert, capital postings, project_members —
    // nothing commits twice) and retries ONCE with a recomputed, strictly
    // higher code. Any other unique violation surfaces unchanged.
    let projectCode = await generateProjectCode(db, tenantId);
    const runProjectCreate = (code: string) => db.transaction(async (tx) => {
      const now = new Date();
      if ((data.shareholders || []).length > 0) {
        await assertFiscalPeriodOpen(tx, tenantId, now);
      }

      // 1. Resolve tenant share value from system_settings
      const [settingRow] = await tx
        .select({
          shareValueBdt: systemSettings.shareValueBdt,
          baseCurrency: systemSettings.baseCurrency,
        })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1);
      const shareValue = Number(settingRow?.shareValueBdt || 1000);
      const tenantCurrency = settingRow?.baseCurrency || 'BDT';

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
            currency: tenantCurrency,
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
        projectType,
        projectMemberPercent,
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
          projectCode: code,
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
          projectType,
          projectMemberPercent: projectMemberPercent ?? null,
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
            // null on every club row: the column only ever describes a contract
            // amount that was actually posted (migration 0032).
            pmCapital: ps.pmCapitalCents === null ? null : fromCents(ps.pmCapitalCents),
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
            description: `Equity investment in project: ${project.title} (${
              ps.pmCapitalCents === null
                ? `${ps.shares} ${ps.shares === 1 ? 'share' : 'shares'} @ ${shareValue.toFixed(2)}`
                : `${ps.investmentFormatted} by Project Level Member contract`
            })`,
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

    let createdProject;
    for (let attempt = 0; ; attempt += 1) {
      try {
        createdProject = await runProjectCreate(projectCode);
        break;
      } catch (e: unknown) {
        if (!isProjectCodeClash(e)) throw e;
        if (attempt >= 1) {
          throw new ConflictError('Could not allocate a project code — please retry.');
        }
        projectCode = await generateProjectCode(db, tenantId);
      }
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'CREATE_PROJECT',
      resourceType: 'Project',
      resourceId: createdProject.id,
      details: {
        title: createdProject.title,
        projectCode: createdProject.projectCode,
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
    return apiError(e, 'Failed to create project');
  }
}
