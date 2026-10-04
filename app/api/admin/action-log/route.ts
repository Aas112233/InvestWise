import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { superAdminActionLog, tenants } from '@/db/schema/index';
import { desc, count, ilike, or, eq, and, notInArray } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { ADMIN_ACTION_TYPES, CONTENT_ACTION_TYPES } from '@/lib/admin/action-log';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const skip = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();
    const action = (searchParams.get('action') || '').trim();
    const tenantId = (searchParams.get('tenantId') || '').trim();

    const db = getDb();
    const filters = [notInArray(superAdminActionLog.actionType, [...CONTENT_ACTION_TYPES])];

    if (search) {
      filters.push(
        or(
          ilike(superAdminActionLog.actionType, `%${search}%`),
          ilike(superAdminActionLog.adminEmail, `%${search}%`),
          ilike(superAdminActionLog.targetType, `%${search}%`),
          ilike(superAdminActionLog.targetId, `%${search}%`),
          ilike(superAdminActionLog.ipAddress, `%${search}%`)
        )!
      );
    }

    if (action) {
      filters.push(eq(superAdminActionLog.actionType, action));
    }

    if (tenantId) {
      filters.push(eq(superAdminActionLog.tenantId, tenantId));
    }

    const whereClause = and(...filters);

    const [totalResult, rows] = await withDbRetry(() =>
      Promise.all([
        db.select({ count: count() }).from(superAdminActionLog).where(whereClause),
        db
          .select({
            id: superAdminActionLog.id,
            adminUserId: superAdminActionLog.adminUserId,
            adminEmail: superAdminActionLog.adminEmail,
            actionType: superAdminActionLog.actionType,
            targetType: superAdminActionLog.targetType,
            targetId: superAdminActionLog.targetId,
            tenantId: superAdminActionLog.tenantId,
            details: superAdminActionLog.details,
            ipAddress: superAdminActionLog.ipAddress,
            createdAt: superAdminActionLog.createdAt,
            tenantName: tenants.name,
            tenantSlug: tenants.slug,
          })
          .from(superAdminActionLog)
          .leftJoin(tenants, eq(tenants.id, superAdminActionLog.tenantId))
          .where(whereClause)
          .orderBy(desc(superAdminActionLog.createdAt))
          .limit(limit)
          .offset(skip),
      ])
    );

    const total = Number(totalResult[0]?.count ?? 0);
    const pages = Math.ceil(total / limit) || 1;

    const data = rows.map((row) => ({
      id: row.id,
      adminUserId: row.adminUserId,
      adminEmail: row.adminEmail,
      actionType: row.actionType,
      targetType: row.targetType || '—',
      targetId: row.targetId || '—',
      tenantId: row.tenantId,
      tenantName: row.tenantName || null,
      tenantSlug: row.tenantSlug || null,
      details: row.details,
      ipAddress: row.ipAddress || '—',
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    }));

    return NextResponse.json({
      success: true,
      data,
      actionTypes: ADMIN_ACTION_TYPES,
      meta: { total, page, limit, pages },
    });
  } catch (error: any) {
    console.error('[ADMIN ACTION LOG ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve platform action log', code: 'ACTION_LOG_FAILED' },
      { status: 500 }
    );
  }
}
