import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { recalculateAllMembersPerformance } from '@/lib/governance/performance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/governance/performance/recalculate-all — rescore every monthly
 * member in the caller's tenant.
 *
 * `app/governance/page.tsx` has always posted to this path, but only the legacy
 * Express router implemented it — on the Next.js side the Recalculate button
 * had no handler and 404'd. This is that handler, tenant-scoped: the legacy
 * `recalculateAllMembersPerformance()` had no tenant filter and rescored every
 * tenant's members.
 *
 * Admin / SuperAdmin only. Audit-logged.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: fail closed without a tenant context.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const role = normalizeRole(user.role);
    if (role !== 'Admin' && role !== 'SuperAdmin') {
      return NextResponse.json(
        { success: false, message: 'Only an Admin can recalculate performance scores' },
        { status: 403 },
      );
    }

    const result = await recalculateAllMembersPerformance(tenantId);

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'PERFORMANCE_RECALCULATED_ALL',
      resourceType: 'Member',
      details: { updatedCount: result.updatedCount },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[GOVERNANCE RECALCULATE-ALL ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to recalculate performance scores' },
      { status: err.statusCode || 500 },
    );
  }
}
