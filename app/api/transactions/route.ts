import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users, systemSettings } from '@/db/schema/index';
import { eq, and, desc, sql, ilike, gte, lte, count } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: the ledger is tenant business data — null tenant must
    // 403 instead of aggregating every tenant's inflow/outflow.
    const scopedTenantId = requireTenant(tenantId, user);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;

    const type = searchParams.get('type');
    const fundId = searchParams.get('fundId');
    const projectId = searchParams.get('projectId');
    const memberId = searchParams.get('memberId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const hasProject = searchParams.get('hasProject') === 'true';

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Filter out soft-deleted by default
    if (!includeDeleted) {
      conditions.push(sql`${transactions.isDeleted} = false`);
    }

    // Unconditional tenant predicate — scopedTenantId already 403s on null.
    conditions.push(sql`${transactions.tenantId} = ${scopedTenantId}`);
    if (type && type !== 'All') {
      conditions.push(sql`${transactions.type} = ${type}`);
    }
    if (fundId) {
      conditions.push(sql`${transactions.fundId} = ${fundId}`);
    }
    if (projectId) {
      conditions.push(sql`${transactions.projectId} = ${projectId}`);
    } else if (hasProject) {
      conditions.push(sql`${transactions.projectId} IS NOT NULL`);
    }
    if (memberId) {
      conditions.push(sql`${transactions.memberId} = ${memberId}`);
    }
    if (status) {
      conditions.push(sql`${transactions.status} = ${status}`);
    }
    if (startDate) {
      conditions.push(gte(transactions.date, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(transactions.date, new Date(endDate)));
    }
    if (search) {
      const term = search.trim();
      if (term) {
        // Full transaction id → exact PK lookup (index scan, no fuzzy matching).
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (UUID_RE.test(term)) {
          conditions.push(sql`${transactions.id} = ${term}`);
        } else {
          // Reference # / partial id / description / member-name contains-search.
          // All arms are served by pg_trgm GIN indexes (idx_trans_ref_trgm,
          // idx_trans_desc_trgm, idx_trans_id_text_trgm, idx_members_name_trgm)
          // — no seq scan. The members join is already tenant-scoped below.
          const like = `%${term}%`;
          conditions.push(sql`(
            ${transactions.referenceNumber} ILIKE ${like}
            OR ${transactions.description} ILIKE ${like}
            OR ${transactions.id}::text ILIKE ${like}
            OR ${members.name} ILIKE ${like}
          )`);
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Aggregate queries for inflow & outflow
    const [totalRes, sumRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(whereClause),
      db
        .select({
          inflow: sql<number>`coalesce(sum(case when ${transactions.type} in ('Deposit', 'Earning', 'Transfer In', 'Investment') then ${transactions.amount}::numeric else 0 end), 0)::float`,
          outflow: sql<number>`coalesce(sum(case when ${transactions.type} in ('Expense', 'Dividend', 'Disbursement', 'Transfer Out', 'Withdrawal') then ${transactions.amount}::numeric else 0 end), 0)::float`,
        })
        .from(transactions)
        .where(whereClause),
      db
        .select({
          id: transactions.id,
          referenceNumber: transactions.referenceNumber,
          transferGroupId: transactions.transferGroupId,
          date: transactions.date,
          type: transactions.type,
          category: transactions.category,
          amount: transactions.amount,
          status: transactions.status,
          description: transactions.description,
          memberId: transactions.memberId,
          memberName: members.name,
          memberCode: members.memberId,
          fundId: transactions.fundId,
          fundName: funds.name,
          projectId: transactions.projectId,
          projectName: projects.title,
          handlingOfficer: transactions.handlingOfficer,
          depositMethod: transactions.depositMethod,
          authorizedBy: transactions.authorizedBy,
          isDeleted: transactions.isDeleted,
          deletionReason: transactions.deletionReason,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        // §6: joined entities must belong to the same tenant — joining on id
        // alone would render another tenant's member/fund/project names.
        .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, scopedTenantId)))
        .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, scopedTenantId)))
        .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, scopedTenantId)))
        .where(whereClause)
        .orderBy(desc(transactions.date))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;
    const totalInflow = sumRes[0]?.inflow ?? 0;
    const totalOutflow = sumRes[0]?.outflow ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      metrics: {
        totalInflow,
        totalOutflow,
        netFlow: totalInflow - totalOutflow,
      },
    });
  } catch (err: any) {
    console.error('[TRANSACTIONS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch transactions' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: generic transactions write ledger rows — null tenant must
    // 403 instead of inserting NULL-tenant orphans. Cross-tenant fund/member/
    // project ids are rejected below.
    const scopedTenantId = requireTenant(tenantId, user);

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to record transactions');
    }

    const body = await request.json();
    const {
      type,
      amount,
      description,
      category,
      fundId,
      memberId,
      projectId,
      date,
      depositMethod,
      referenceNumber,
    } = body;

    const numAmount = Number(amount);
    if (!type || !numAmount || numAmount <= 0 || !description) {
      throw new ValidationError('Valid transaction type, positive amount, and description are required');
    }

    const db = getDb();
    const refNum = referenceNumber || `TXN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

    // §6: referenced entities must belong to the caller's tenant — otherwise a
    // crafted fundId/memberId/projectId links this tenant's ledger row to
    // another tenant's entities (and leaks their existence via NotFound vs ok).
    if (fundId) {
      const [fund] = await db
        .select({ id: funds.id })
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1);
      if (!fund) throw new ValidationError("[Field 'fundId', Code: cross_tenant] Fund does not belong to this tenant");
    }
    if (memberId) {
      const [member] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .limit(1);
      if (!member) throw new ValidationError("[Field 'memberId', Code: cross_tenant] Member does not belong to this tenant");
    }
    if (projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, scopedTenantId)))
        .limit(1);
      if (!project) throw new ValidationError("[Field 'projectId', Code: cross_tenant] Project does not belong to this tenant");
    }

    const [created] = await db
      .insert(transactions)
      .values({
        tenantId: scopedTenantId,
        type,
        amount: String(numAmount),
        description: description.trim(),
        category: category || 'General',
        referenceNumber: refNum,
        fundId: fundId || null,
        memberId: memberId || null,
        projectId: projectId || null,
        date: date ? new Date(date) : new Date(),
        status: 'Completed',
        depositMethod: depositMethod || 'Manual',
        handlingOfficer: user.name,
        createdBy: user.id,
        authorizedBy: user.id,
      })
      .returning();

    // Enforce Rule §12: auto-lock share value once transactions exist (§6:
    // tenant-scoped — a global predicate would lock every tenant because one
    // tenant transacted).
    await db
      .update(systemSettings)
      .set({ isShareValueLocked: true, updatedAt: new Date() })
      .where(and(eq(systemSettings.tenantId, scopedTenantId), eq(systemSettings.isShareValueLocked, false)));

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'RECORD_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: created?.id,
      details: { type, amount: numAmount, referenceNumber: refNum },
    });

    return NextResponse.json({
      success: true,
      data: created,
      message: 'Transaction recorded successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[TRANSACTIONS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record transaction' },
      { status: err.statusCode || 500 }
    );
  }
}
