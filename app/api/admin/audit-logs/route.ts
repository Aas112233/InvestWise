import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { auditLogs } from '@/db/schema/index';
import { desc, count, ilike, or, eq, and } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';

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

    const db = getDb();
    const filters = [];

    if (search) {
      filters.push(
        or(
          ilike(auditLogs.action, `%${search}%`),
          ilike(auditLogs.userName, `%${search}%`),
          ilike(auditLogs.resourceType, `%${search}%`),
          ilike(auditLogs.ipAddress, `%${search}%`)
        )
      );
    }

    if (action) {
      filters.push(eq(auditLogs.action, action));
    }

    const whereClause = filters.length > 1 ? and(...filters) : filters[0];

    const [totalResult, rows] = await Promise.all([
      db.select({ count: count() }).from(auditLogs).where(whereClause),
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(skip),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);
    const pages = Math.ceil(total / limit) || 1;

    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: row.userName || 'System / Anonymous',
      action: row.action,
      resourceType: row.resourceType || 'General',
      resourceId: row.resourceId,
      details: row.details,
      ipAddress: row.ipAddress || '—',
      status: row.status || 'SUCCESS',
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    }));

    return NextResponse.json({
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        pages,
      },
    });
  } catch (error: any) {
    console.error('[AUDIT LOGS ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve audit logs', code: 'AUDIT_LOGS_FAILED' },
      { status: 500 }
    );
  }
}
