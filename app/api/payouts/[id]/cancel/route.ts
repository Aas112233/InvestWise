import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ForbiddenError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { cancelPayoutPlan } from '@/lib/member-payouts';

/**
 * POST /api/payouts/[id]/cancel — closes an open plan and returns the unpaid
 * remainder to the member. A reason is mandatory: this reverses a promised
 * settlement, so it must be reconstructable (§12).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, 'PAYOUTS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: PAYOUTS');
    }

    const body = await readJsonBody(request);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ValidationError("[Field 'reason', Code: required] A cancellation reason is required");
    }

    const { id } = await ctx.params;
    const result = await cancelPayoutPlan({
      tenantId: scopedTenantId,
      user: { id: user.id, name: user.name },
      planId: id,
      reason,
    });
    return NextResponse.json({ success: true, data: result, message: 'Payout plan cancelled' });
  } catch (err: any) {
    console.error('[PAYOUT CANCEL ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to cancel payout plan', code: err.code ?? 'PAYOUT_CANCEL_FAILED' },
      { status: err.statusCode || 500 },
    );
  }
}
