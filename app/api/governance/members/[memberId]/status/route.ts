import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { reinstateMember, suspendMember } from '@/lib/governance/status-service';
import { ValidationError } from '@/lib/utils/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/governance/members/[memberId]/status — admin status lifecycle.
 *
 * Body: { action: 'suspend' | 'reinstate', reason: string }
 *
 * Suspension is never applied by the automated sweep, because it blocks portal
 * login — it is always an explicit, reasoned, audit-logged admin action. Holding
 * and restoring are automatic; this endpoint is only for the manual override and
 * for the suspension the sweep deliberately stops short of.
 *
 * Restricted to Admin / SuperAdmin. Managers cannot suspend a member.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const role = normalizeRole(user.role);
    if (role !== 'Admin' && role !== 'SuperAdmin') {
      return NextResponse.json(
        { success: false, message: 'Only an Admin can change a member status' },
        { status: 403 },
      );
    }

    const { memberId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? '').trim().toLowerCase();
    const reason = String(body?.reason ?? '').trim();

    if (action !== 'suspend' && action !== 'reinstate') {
      throw new ValidationError("action must be either 'suspend' or 'reinstate'");
    }
    if (!reason) {
      throw new ValidationError('A reason is required and is recorded in the audit log');
    }

    const actor = { id: user.id, name: user.name };
    const result =
      action === 'suspend'
        ? await suspendMember(tenantId, memberId, actor, reason)
        : await reinstateMember(tenantId, memberId, actor, reason);

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[GOVERNANCE MEMBER STATUS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to change member status' },
      { status: err.statusCode || 500 },
    );
  }
}
