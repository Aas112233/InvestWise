import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectMembers, members, funds, transactions, systemSettings } from '@/db/schema/index';
import { eq, and, desc, ilike, or, count, inArray, sql, type SQL } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { projectCreateSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from './_helpers';
import { toCents, fromCents } from '@/lib/money';
import crypto from 'node:crypto';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

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

    const body = await request.json();
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

      // 3. Process Shareholders under Option A:
      // Deduct required investment (shares * shareValue) from member deposit
      // equity. All rows lock in ONE deterministic-order statement and write
      // back in one grouped UPDATE — N shareholders cost 2 round-trips, not 2N.
      const rawShareholders = data.shareholders || [];
      const totalShares = rawShareholders.reduce((acc, s) => acc + s.shares, 0);

      // Prevent duplicate members in the shareholder list
      const seenMemberIds = new Set<string>();
      for (const s of rawShareholders) {
        if (seenMemberIds.has(s.memberId)) {
          throw new ValidationError('Duplicate member found in project shareholder list');
        }
        seenMemberIds.add(s.memberId);
      }

      const shareholderIds = rawShareholders.map((s) => s.memberId).sort();
      const lockedMembers = shareholderIds.length
        ? await tx
            .select({ id: members.id, name: members.name, totalContributed: members.totalContributed })
            .from(members)
            .where(and(inArray(members.id, shareholderIds), eq(members.tenantId, tenantId)))
            .orderBy(members.id)
            .for('update')
        : [];
      const memberById = new Map(lockedMembers.map((m) => [m.id, m]));

      let totalShareholderCapitalCents = 0;
      const processedShareholders: Array<{
        memberId: string;
        memberName: string;
        shares: number;
        investmentCents: number;
        investmentFormatted: string;
        ownershipPercentage: string;
        memberEquityBefore: string;
        memberEquityAfter: string;
      }> = [];

      // Validate every balance before writing anything — a mid-list failure
      // rolls the transaction back either way, but failing first keeps the
      // error deterministic and the locks brief.
      for (const sh of rawShareholders) {
        const member = memberById.get(sh.memberId);
        if (!member) {
          throw new ValidationError(`Member not found: ${sh.memberId}`);
        }

        const requiredAmount = sh.shares * shareValue;
        const requiredAmountCents = toCents(requiredAmount);
        totalShareholderCapitalCents += requiredAmountCents;

        const availableCents = toCents(member.totalContributed ?? '0');
        if (availableCents < requiredAmountCents) {
          throw new ValidationError(
            `Member '${member.name}' has insufficient deposit balance (Available: ${fromCents(availableCents)}, Required: ${fromCents(requiredAmountCents)})`,
          );
        }

        const ownershipPercentage = totalShares > 0
          ? ((sh.shares / totalShares) * 100).toFixed(2)
          : '0.00';

        processedShareholders.push({
          memberId: member.id,
          memberName: member.name,
          shares: sh.shares,
          investmentCents: requiredAmountCents,
          investmentFormatted: fromCents(requiredAmountCents),
          ownershipPercentage,
          memberEquityBefore: fromCents(availableCents),
          memberEquityAfter: fromCents(availableCents - requiredAmountCents),
        });
      }

      const now = new Date();

      if (processedShareholders.length > 0) {
        // Grouped equity deduction: one round-trip under the row locks held
        // above. The §6 tenant predicate stays in the WHERE — a VALUES join
        // must never widen the write scope.
        await tx.execute(sql`
          UPDATE ${members} AS m
          SET total_contributed = v.balance::numeric,
              updated_at = ${now}
          FROM (VALUES ${sql.join(
            processedShareholders.map((ps) => sql`(${ps.memberId}::uuid, ${ps.memberEquityAfter}::numeric)`),
            sql`, `,
          )}) AS v(id, balance)
          WHERE m.id = v.id AND m.tenant_id = ${tenantId}
        `);
      }

      // 4. Initial balance: the project fund starts with shareholder capital
      // only. `initialInvestment` stays a descriptive planning field — it is
      // NOT credited to the fund because it has no identifiable source
      // account (§12: no money without a counter-entry; real initial spend is
      // posted as a journaled project Expense after creation).
      const startingProjectBalanceStr = fromCents(totalShareholderCapitalCents);

      // If linked/created fund, credit the starting balance
      if (targetFundId) {
        await tx
          .update(funds)
          .set({
            balance: sql<string>`(${funds.balance}::numeric + ${startingProjectBalanceStr}::numeric)::numeric(15,2)`,
            updatedAt: new Date(),
          })
          .where(and(eq(funds.id, targetFundId), eq(funds.tenantId, tenantId)));
      }

      // 5. Insert project record
      const [project] = await tx
        .insert(projects)
        .values({
          tenantId,
          title: data.title,
          category: data.category,
          description: data.description,
          budget: String(data.budget),
          initialInvestment: String(data.initialInvestment),
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
      action: 'CREATE_PROJECT',
      resourceType: 'Project',
      resourceId: createdProject.id,
      details: {
        title: createdProject.title,
        budget: createdProject.budget,
        totalShares: createdProject.totalShares,
        shareholderCount: createdProject.shareholders.length,
      },
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
