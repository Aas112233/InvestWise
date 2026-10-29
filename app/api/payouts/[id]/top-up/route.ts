import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/utils/errors';
import { topUpPayoutPlan } from '@/lib/member-payouts';
import { apiError } from '@/lib/utils/api-error';

/**
 * POST /api/payouts/[id]/top-up — reserves money the member earned AFTER the
 * plan was created (a settled project's return) as one more phase.
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
    const result = await topUpPayoutPlan({
      tenantId: scopedTenantId,
      user: { id: user.id, name: user.name },
      planId: id,
    });
    return NextResponse.json({ success: true, data: result, message: 'Project return added to the plan' });
  } catch (err: any) {
    console.error('[PAYOUT TOP-UP ERROR]', err);
    return apiError(err, 'Failed to add project return');
  }
}
