import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { listMemberGovernanceStatuses } from '@/lib/governance/status-service';
import { apiError } from '@/lib/utils/api-error';

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
    // Clamp pagination: `limit` flows into listMemberGovernanceStatuses, which
    // computes per-member compliance for every row on the page — an unbounded
    // limit here is a per-request CPU DoS.
    const result = await listMemberGovernanceStatuses(tenantId, {
      page: Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20)),
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
    return apiError(err, 'Failed to fetch governance member status');
  }
}
