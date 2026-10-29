import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import {
  tenants,
  tenantSubscriptions,
  subscriptionPlans,
  subscriptionChangeLog,
} from '@/db/schema/index';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';

// GET /api/admin/subscriptions/[tenantId] — platform-only per-tenant
// lifecycle view: the subscription row with its plan, the last 10 change-log
// entries and the plan catalogue the control panel offers. Mutations deliberately
// go through POST /api/admin/billing, which already validates and audits every
// transition — this route is read-only so there is exactly one write path.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { tenantId } = await params;
    const db = getDb();

    const [tenant] = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) {
      return NextResponse.json(
        { success: false, message: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const [subscription] = await db
      .select({
        id: tenantSubscriptions.id,
        status: tenantSubscriptions.status,
        currentPeriodStart: tenantSubscriptions.currentPeriodStart,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        trialEndsAt: tenantSubscriptions.trialEndsAt,
        graceEndsAt: tenantSubscriptions.graceEndsAt,
        planId: subscriptionPlans.id,
        planSlug: subscriptionPlans.slug,
        planName: subscriptionPlans.name,
        priceMonthly: subscriptionPlans.priceMonthly,
        planMaxUsers: subscriptionPlans.maxUsers,
        planIsActive: subscriptionPlans.isActive,
      })
      .from(tenantSubscriptions)
      .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenant.id))
      .limit(1);

    const history = await db
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
      .where(eq(subscriptionChangeLog.tenantId, tenant.id))
      .orderBy(desc(subscriptionChangeLog.createdAt))
      .limit(10);

    const plans = await db
      .select({
        id: subscriptionPlans.id,
        slug: subscriptionPlans.slug,
        name: subscriptionPlans.name,
        priceMonthly: subscriptionPlans.priceMonthly,
        maxUsers: subscriptionPlans.maxUsers,
        isActive: subscriptionPlans.isActive,
      })
      .from(subscriptionPlans);

    return NextResponse.json({
      success: true,
      data: {
        tenant,
        subscription: subscription
          ? {
              ...subscription,
              currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
              currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
              trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
              graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
            }
          : null,
        history: history.map((h) => ({ ...h, createdAt: h.createdAt?.toISOString() ?? null })),
        plans,
      },
    });
  } catch (error: unknown) {
    console.error('[SUBSCRIPTION VIEW ERROR]', error);
    if (error instanceof AppError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code ?? 'SUBSCRIPTION_FAILED' },
        { status: e.statusCode ?? 500 },
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load subscription', code: 'SUBSCRIPTION_FAILED' },
      { status: 500 },
    );
  }
}
