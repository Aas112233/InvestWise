import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { listMemberGovernanceStatuses } from '@/lib/governance/status-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/governance/members — paginated deposit-compliance view of the tenant.
 *
 * Every member is returned with their months-without-deposit count and what the
 * rules engine would do to them, so the Governance screen can show held,
 * suspension-eligible and restore-recommended members without recomputing
 * anything on the client (§6: money logic stays server-side).
 */
export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (normalizeRole(user.role) === 'Member') {
      return NextResponse.json(
        { success: false, message: 'Insufficient permissions to view governance data' },
        { status: 403 },
      );
    }
    // §6: fail closed without a tenant context rather than defaulting to one.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const result = await listMemberGovernanceStatuses(tenantId, {
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '20', 10),
      search: searchParams.get('search'),
      status: searchParams.get('status'),
    });

    return NextResponse.json({
      success: true,
      data: result.members,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
      rules: result.rules,
      ...(result.rulesProblem ? { rulesProblem: result.rulesProblem } : {}),
    });
  } catch (err: any) {
    console.error('[GOVERNANCE MEMBERS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch governance member status' },
      { status: err.statusCode || 500 },
    );
  }
}
