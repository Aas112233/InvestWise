import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { auditLogs } from '@/db/schema/index';
import { and, gte, desc, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';

interface Notification {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userName: string | null;
  createdAt: Date;
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

    const db = getDb();
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        userName: auditLogs.userName,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          gte(auditLogs.createdAt, since),
          sql`${auditLogs.action} ~ '^(CREATE|UPDATE|DELETE|ADD|EDIT)'`,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(20);

    const notifications: Notification[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      userName: r.userName,
      createdAt: r.createdAt!,
    }));

    return NextResponse.json(notifications);
  } catch (error: any) {
    console.error('[GET NOTIFICATIONS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get notifications', code: 'NOTIFICATIONS_FAILED' },
      { status: 500 }
    );
  }
}