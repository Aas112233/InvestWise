import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { subscriptionChangeLog } from '@/db/schema/index';
import { eq, desc, count } from 'drizzle-orm';
import { AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getPaginationParams } from '@/lib/utils/types';

// GET /api/admin/billing/history?tenantId=<uuid>&page=&limit= — platform-only
// per-tenant subscription change timeline. Plan ids resolve client-side
// against the plans array in GET /api/admin/billing.
export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (!params.tenantId) {
      return NextResponse.json(
        { success: false, message: 'tenantId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { page, limit, skip } = getPaginationParams(params, { limit: 20 });
    const db = getDb();
    const where = eq(subscriptionChangeLog.tenantId, params.tenantId);

    const [totalRow] = await db
      .select({ total: count() })
      .from(subscriptionChangeLog)
      .where(where);
    const rows = await db
      .select({
        id: subscriptionChangeLog.id,
        action: subscriptionChangeLog.action,
        actorEmail: subscriptionChangeLog.actorEmail,
        fromPlanId: subscriptionChangeLog.fromPlanId,
        toPlanId: subscriptionChangeLog.toPlanId,
        fromStatus: subscriptionChangeLog.fromStatus,
        toStatus: subscriptionChangeLog.toStatus,
        reason: subscriptionChangeLog.reason,
        createdAt: subscriptionChangeLog.createdAt,
      })
      .from(subscriptionChangeLog)
      .where(where)
      .orderBy(desc(subscriptionChangeLog.createdAt))
      .limit(limit)
      .offset(skip);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { total: Number(totalRow?.total ?? 0), page, limit },
    });
  } catch (error: unknown) {
    console.error('[BILLING HISTORY ERROR]', error);
    if (error instanceof AppError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code ?? 'BILLING_FAILED' },
        { status: e.statusCode ?? 500 },
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load billing history', code: 'BILLING_FAILED' },
      { status: 500 },
    );
  }
}
