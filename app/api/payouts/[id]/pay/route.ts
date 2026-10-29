import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/utils/errors';
import { payPayoutInstallment } from '@/lib/member-payouts';
import { apiError } from '@/lib/utils/api-error';

/**
 * POST /api/payouts/[id]/pay — releases the oldest unpaid installment.
 * No body: the phase and its amount are decided by the plan, never by the
 * caller, so a tampered request cannot invent a payment.
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

    const { id } = await ctx.params;
    const result = await payPayoutInstallment({
      tenantId: scopedTenantId,
      user: { id: user.id, name: user.name },
      planId: id,
    });
    return NextResponse.json({ success: true, data: result, message: 'Installment paid' });
  } catch (err: any) {
    console.error('[PAYOUT PAY ERROR]', err);
    return apiError(err, 'Failed to pay installment');
  }
}
