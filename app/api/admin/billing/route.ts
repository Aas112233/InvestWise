import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, tenantSubscriptions, subscriptionPlans } from '@/db/schema/index';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { AuthError, ForbiddenError, ConflictError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { changeTenantSubscription } from '@/lib/superadmin-service';
import { getClientIp } from '@/lib/request-meta';
import { parseDateTimeInput as parseSharedDateTimeInput } from '@/lib/admin/date-input';

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

// POST /api/admin/billing { tenantId, planSlug?, status?, reason?, graceEndsAt?,
//                           currentPeriodEnd?, trialEndsAt? }
// — platform-only plan/status/date transition with change log + platform audit.
const ALLOWED_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired'];

/**
 * Accepts a native <input type="datetime-local"> value (YYYY-MM-DDTHH:mm[:ss],
 * no timezone) as well as a qualified ISO string, and validates the calendar
 * components so an impossible date like Feb 30 is rejected instead of being
 * silently rolled over by the Date constructor. Shared with the admin UI via
 * lib/admin/date-input.ts.
 */
function parseDateTimeInput(value: unknown, field = 'date') {
  return parseSharedDateTimeInput(value, field);
}

export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const {
      tenantId,
      planSlug,
      status,
      reason,
      graceEndsAt,
      currentPeriodEnd,
      trialEndsAt,
      gracePeriodDays,
    } = body;
    if (!tenantId) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'tenantId', Code: invalid_type] tenantId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }
    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          message: `[Field 'status', Code: invalid_enum] Must be one of: ${ALLOWED_STATUSES.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }
    if (
      reason !== undefined &&
      reason !== null &&
      (typeof reason !== 'string' || reason.length > 500)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'reason', Code: too_long] Reason must be a string of at most 500 characters",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }
    if (
      gracePeriodDays !== undefined &&
      gracePeriodDays !== null &&
      (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 3650)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'gracePeriodDays', Code: out_of_range] Must be an integer between 0 and 3650",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }

    // Date overrides are validated before anything is written, so a typo cannot
    // half-apply a plan change alongside a rejected date.
    let parsedPeriodEnd: Date | null | undefined;
    if (currentPeriodEnd !== undefined) {
      if (currentPeriodEnd === null) {
        parsedPeriodEnd = null;
      } else {
        const r = parseDateTimeInput(currentPeriodEnd, 'currentPeriodEnd');
        if (!r.ok) {
          return NextResponse.json(
            { success: false, message: r.message, code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
        }
        parsedPeriodEnd = r.date;
      }
    }

    let parsedTrialEnd: Date | null | undefined;
    if (trialEndsAt !== undefined) {
      if (trialEndsAt === null) {
        parsedTrialEnd = null;
      } else {
        const r = parseDateTimeInput(trialEndsAt, 'trialEndsAt');
        if (!r.ok) {
          return NextResponse.json(
            { success: false, message: r.message, code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
        }
        parsedTrialEnd = r.date;
      }
    }

    // gracePeriodDays is a convenience over graceEndsAt: it is resolved against
    // the period end that this same call is setting, or the existing one.
    let parsedGrace: Date | null | undefined;
    if (gracePeriodDays !== undefined && gracePeriodDays !== null) {
      const anchor =
        parsedPeriodEnd ?? null;
      if (!anchor) {
        return NextResponse.json(
          {
            success: false,
            message:
              "[Field 'gracePeriodDays', Code: missing_anchor] Provide currentPeriodEnd in the same request so the grace window has an anchor",
            code: 'VALIDATION_ERROR',
          },
          { status: 400 },
        );
      }
      parsedGrace = new Date(anchor.getTime() + gracePeriodDays * 86_400_000);
    } else if (graceEndsAt !== undefined) {
      if (graceEndsAt === null) {
        parsedGrace = null;
      } else {
        const r = parseDateTimeInput(graceEndsAt, 'graceEndsAt');
        if (!r.ok) {
          return NextResponse.json(
            { success: false, message: r.message, code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
        }
        parsedGrace = r.date;
      }
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
        graceEndsAt: parsedGrace,
        currentPeriodEnd: parsedPeriodEnd,
        trialEndsAt: parsedTrialEnd,
      },
      { adminUserId: platformUser.id, adminEmail: platformUser.email, ipAddress: getClientIp(request) },
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
