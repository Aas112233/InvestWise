import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { auditLogs, users } from '@/db/schema/index';
import { eq, and, gte, lte, count, desc, asc, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { getPaginationParams, formatPaginatedResponse } from '@/lib/utils/types';

interface AuditLogQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Check if user has permission to view audit logs (Admin/Manager)
    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin or Manager access required');
    }

    const { searchParams } = new URL(request.url);
    const query: AuditLogQuery = {
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
      action: searchParams.get('action') || undefined,
      resourceType: searchParams.get('resourceType') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      search: searchParams.get('search') || undefined,
    };

    const db = getDb();
    const { page, limit, skip } = getPaginationParams(query as Record<string, string>);

    const conditions: ReturnType<typeof sql>[] = [];

    if (query.action) {
      conditions.push(sql`${auditLogs.action} ILIKE ${'%' + query.action + '%'}`);
    }

    if (query.resourceType) {
      conditions.push(eq(auditLogs.resourceType, query.resourceType));
    }

    if (query.startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(query.startDate)));
    }

    if (query.endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(query.endDate)));
    }

    if (query.search) {
      conditions.push(
        sql`(${auditLogs.userName} ILIKE ${'%' + query.search + '%'} OR ${auditLogs.details}::text ILIKE ${'%' + query.search + '%'})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const orderByClause = query.sortOrder === 'asc'
      ? asc(auditLogs.createdAt)
      : desc(auditLogs.createdAt);

    const [totalResult, logs] = await Promise.all([
      db.select({ count: count() }).from(auditLogs).where(whereClause),
      db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          userName: auditLogs.userName,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          details: auditLogs.details,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          status: auditLogs.status,
          createdAt: auditLogs.createdAt,
          updatedAt: auditLogs.updatedAt,
          userEmail: users.email,
          userRole: users.role,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(skip),
    ]);

    return NextResponse.json(formatPaginatedResponse(logs, page, limit, Number(totalResult[0]?.count ?? 0)));
  } catch (error: any) {
    console.error('[GET AUDIT LOGS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get audit logs', code: 'AUDIT_LOGS_FAILED' },
      { status: 500 }
    );
  }
}