import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { auditLogs } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
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

    // §6: metadata derives from the tenant's own audit trail.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const db = getDb();

    const [actionRows, resourceTypeRows] = await Promise.all([
      db
        .selectDistinct({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenantId)),
      db
        .selectDistinct({ resourceType: auditLogs.resourceType })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenantId)),
    ]);

    return NextResponse.json({
      actions: actionRows.map((r) => r.action).filter((a): a is string => a !== null),
      resourceTypes: resourceTypeRows
        .map((r) => r.resourceType)
        .filter((rt): rt is string => rt !== null),
    });
  } catch (error: any) {
    console.error('[GET AUDIT METADATA ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get audit metadata', code: 'AUDIT_METADATA_FAILED' },
      { status: 500 }
    );
  }
}