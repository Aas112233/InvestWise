import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users } from '@/db/schema/index';
import { eq, and, or, desc, asc, count, ilike, gte, lte, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole } from '@/lib/roles';
import { ForbiddenError } from '@/lib/utils/errors';
import { endOfRangeUtc } from '@/lib/formatters';

/**
 * Admin-level recovery desk: every soft-deleted transaction for THIS tenant.
 *
 * Source of truth is `transactions.isDeleted = true` — the canonical
 * soft-delete state that every writer maintains (deletedBy / deletedAt /
 * deletionReason). The `deleted_records` table is a secondary immutable
 * archive that only the finance service path populates, so reading it here
 * would silently hide everything deleted through DELETE /api/transactions/[id].
 *
 * §6: tenant-scoped, Admin/SuperAdmin only — this exposes retracted money
 * movements (and the operator who retracted them) across the whole tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to view deleted transactions');
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
    const skip = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();
    const type = searchParams.get('type');
    const memberId = searchParams.get('memberId');
    const fundId = searchParams.get('fundId');
    const deletedById = searchParams.get('deletedById');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const sortBy = searchParams.get('sortBy') || 'deletedAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    const db = getDb();
    const conditions = [
      sql`${transactions.tenantId} = ${scopedTenantId}`,
      sql`${transactions.isDeleted} = true`,
    ];

    if (type && type !== 'All') conditions.push(sql`${transactions.type} = ${type}`);
    if (memberId) conditions.push(sql`${transactions.memberId} = ${memberId}`);
    if (fundId) conditions.push(sql`${transactions.fundId} = ${fundId}`);
    if (deletedById) conditions.push(sql`${transactions.deletedBy} = ${deletedById}`);
    // Date filters apply to the DELETION timestamp — this desk is ordered by
    // when money was retracted, not when it originally moved.
    if (startDate) conditions.push(gte(transactions.deletedAt, new Date(startDate)));
    if (endDate) conditions.push(lte(transactions.deletedAt, endOfRangeUtc(endDate)));
    if (search) {
      conditions.push(
        sql`(${transactions.description} ILIKE ${'%' + search + '%'}
             OR ${transactions.referenceNumber} ILIKE ${'%' + search + '%'}
             OR ${transactions.deletionReason} ILIKE ${'%' + search + '%'}
             OR ${transactions.id}::text ILIKE ${'%' + search + '%'})`,
      );
    }

    const whereClause = and(...conditions);
    const sortColumn =
      sortBy === 'amount'
        ? transactions.amount
        : sortBy === 'date'
          ? transactions.date
          : sortBy === 'type'
            ? transactions.type
            : transactions.deletedAt;
    const orderFn = sortOrder === 'asc' ? asc : desc;

    const [totalRes, rows] = await Promise.all([
      db.select({ count: count() }).from(transactions).where(whereClause),
      db
        .select({
          id: transactions.id,
          referenceNumber: transactions.referenceNumber,
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
          depositMethod: transactions.depositMethod,
          handlingOfficer: transactions.handlingOfficer,
          deletedAt: transactions.deletedAt,
          deletedBy: transactions.deletedBy,
          deletedByName: users.name,
          deletionReason: transactions.deletionReason,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        // §6: joined labels must belong to the same tenant — an id-only join
        // would disclose another tenant's member/fund/deleter names.
        .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, scopedTenantId)))
        .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, scopedTenantId)))
        .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, scopedTenantId)))
        .leftJoin(users, and(eq(transactions.deletedBy, users.id), eq(users.tenantId, scopedTenantId)))
        .where(whereClause)
        .orderBy(orderFn(sortColumn), desc(transactions.id))
        .limit(limit)
        .offset(skip),
    ]);

    const total = Number(totalRes[0]?.count ?? 0);

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[DELETED TRANSACTIONS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch deleted transactions' },
      { status: err.statusCode || 500 },
    );
  }
}
