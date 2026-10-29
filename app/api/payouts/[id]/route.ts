import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/utils/errors';
import { getPayoutPlan } from '@/lib/member-payouts';
import { apiError } from '@/lib/utils/api-error';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, 'PAYOUTS', 'READ')) {
      throw new ForbiddenError('Read permission required for: PAYOUTS');
    }

    const { id } = await ctx.params;
    return NextResponse.json({ success: true, data: await getPayoutPlan(scopedTenantId, id) });
  } catch (err: any) {
    console.error('[PAYOUT DETAIL ERROR]', err);
    return apiError(err, 'Failed to fetch payout plan');
  }
}
