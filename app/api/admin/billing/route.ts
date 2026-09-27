import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, tenantSubscriptions, subscriptionPlans } from '@/db/schema/index';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { AuthError, ForbiddenError, ConflictError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { changeTenantSubscription } from '@/lib/superadmin-service';

// GET /api/admin/billing — platform-only lifecycle view: every tenant with
// its subscription, plan and user count.
export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const db = getDb();
    const rows = await db
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        tenantStatus: tenants.status,
        maxUsers: tenants.maxUsers,
        subscriptionId: tenantSubscriptions.id,
        subscriptionStatus: tenantSubscriptions.status,
        currentPeriodStart: tenantSubscriptions.currentPeriodStart,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        trialEndsAt: tenantSubscriptions.trialEndsAt,
        graceEndsAt: tenantSubscriptions.graceEndsAt,
        planSlug: subscriptionPlans.slug,
        planName: subscriptionPlans.name,
        priceMonthly: subscriptionPlans.priceMonthly,
      })
      .from(tenants)
      .leftJoin(tenantSubscriptions, eq(tenantSubscriptions.tenantId, tenants.id))
      .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, tenantSubscriptions.planId))
      .orderBy(desc(tenants.createdAt));

    const userCounts: Record<string, number> = {};
    const ids = rows.map((r) => r.tenantId);
    if (ids.length > 0) {
      const countRows = await db
        .select({ tenantId: users.tenantId, count: count() })
        .from(users)
        .where(inArray(users.tenantId, ids))
        .groupBy(users.tenantId);
      for (const row of countRows) {
        if (row.tenantId) userCounts[row.tenantId] = Number(row.count || 0);
      }
    }

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ ...r, userCount: userCounts[r.tenantId] ?? 0 })),
      plans: await db
        .select({
          id: subscriptionPlans.id,
          slug: subscriptionPlans.slug,
          name: subscriptionPlans.name,
          priceMonthly: subscriptionPlans.priceMonthly,
          maxUsers: subscriptionPlans.maxUsers,
          isActive: subscriptionPlans.isActive,
        })
        .from(subscriptionPlans)
        .orderBy(desc(subscriptionPlans.createdAt)),
    });
  } catch (error: unknown) {
    console.error('[BILLING VIEW ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, message: 'Failed to load billing view', code: 'BILLING_FAILED' }, { status: 500 });
  }
}

// POST /api/admin/billing { tenantId, planSlug?, status?, reason?, graceEndsAt? }
// — platform-only plan/status transition with change log + platform audit.
const ALLOWED_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired'];

export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const { tenantId, planSlug, status, reason, graceEndsAt } = body;
    if (!tenantId) {
      return NextResponse.json(
        { success: false, message: 'tenantId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, message: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) {
      return NextResponse.json({ success: false, message: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await changeTenantSubscription(
      {
        tenantId,
        planSlug,
        status,
        reason,
        graceEndsAt: graceEndsAt === null ? null : graceEndsAt ? new Date(graceEndsAt) : undefined,
      },
      { adminUserId: platformUser.id, adminEmail: platformUser.email },
    );

    // changeTenantSubscription writes both the change log and the
    // super_admin_action_log row; no duplicate audit here.

    return NextResponse.json({ success: true, message: 'Subscription updated successfully' });
  } catch (error: unknown) {
    console.error('[BILLING UPDATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError || error instanceof Error) {
      const e = error as { message: string; code?: string; statusCode?: number };
      const status = e.statusCode ?? (/Unknown subscription plan/i.test(e.message) ? 400 : 500);
      return NextResponse.json({ success: false, message: e.message, code: e.code ?? 'BILLING_UPDATE_FAILED' }, { status });
    }
    return NextResponse.json({ success: false, message: 'Subscription update failed', code: 'BILLING_UPDATE_FAILED' }, { status: 500 });
  }
}
