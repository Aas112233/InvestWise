import { NextRequest, NextResponse } from 'next/server';
import { evaluateSubscriptionExpiry, logSuperAdminAction } from '@/lib/superadmin-service';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/billing/run-expiry — manual trigger for the subscription
 * expiry sweep, so an operator can enforce a deadline transition immediately
 * after editing dates instead of waiting for the Vercel cron.
 *
 * The sweep itself (evaluateSubscriptionExpiry) is idempotent: re-running over
 * unchanged state reports zero transitions, and every transition it performs
 * already writes its own change-log and platform-audit rows. The manual
 * trigger additionally records one EXPIRY_SWEEP_MANUAL audit row attributing
 * the invocation to the operator.
 */
export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const context = {
      adminUserId: platformUser.id,
      adminEmail: platformUser.email,
      ipAddress: getClientIp(request),
    };
    const result = await evaluateSubscriptionExpiry(context);
    await logSuperAdminAction({
      context,
      actionType: 'EXPIRY_SWEEP_MANUAL',
      targetType: 'Platform',
      details: { ...result },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('[EXPIRY SWEEP ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.statusCode ?? 403 });
    }
    return NextResponse.json(
      { success: false, message: 'Subscription expiry sweep failed', code: 'EXPIRY_FAILED' },
      { status: 500 },
    );
  }
}
