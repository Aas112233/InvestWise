import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, withDbRetry } from '@/db/index';
import { subscriptionPlans, tenantSubscriptions } from '@/db/schema/index';
import { asc, eq, sql } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import { logSuperAdminAction } from '@/lib/superadmin-service';

// Plan catalogue CRUD. `subscription_plans` was previously seed-only: the billing
// screen could change which plan a tenant was on but never which plans exist, so
// a tier could not be repriced or retired without a direct database write.

const planCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits and dashes'),
  name: z.string().trim().min(1).max(255),
  // Money crosses the wire as a decimal string; parsed to cents here so no
  // float ever touches a price (AGENTS.md §8).
  priceMonthly: z
    .string()
    .trim()
    .regex(/^\d{1,13}(\.\d{1,2})?$/, 'priceMonthly must be a positive amount with at most 2 decimals')
    .refine((v) => Number(v) >= 0, 'priceMonthly must be >= 0'),
  maxUsers: z.number().int().min(1).max(1_000_000),
  isActive: z.boolean().optional(),
});

const planUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    priceMonthly: z
      .string()
      .trim()
      .regex(/^\d{1,13}(\.\d{1,2})?$/, 'priceMonthly must be a positive amount with at most 2 decimals')
      .optional(),
    maxUsers: z.number().int().min(1).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided',
  });

function fieldError(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'body';
  return {
    success: false,
    message: `[Field '${field}', Code: ${issue?.code || 'invalid_type'}] ${issue?.message || 'Invalid input'}`,
    code: 'VALIDATION_ERROR',
  };
}

export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const rows = await withDbRetry(() =>
      getDb()
        .select()
        .from(subscriptionPlans)
        .orderBy(asc(subscriptionPlans.priceMonthly))
    );

    return NextResponse.json({
      success: true,
      data: rows.map((p) => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : '',
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : '',
      })),
    });
  } catch (error: unknown) {
    console.error('[PLANS LIST ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load plans', code: 'PLANS_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const parsed = planCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(fieldError(parsed.error), { status: 400 });
    }
    const { slug, name, priceMonthly, maxUsers, isActive } = parsed.data;

    const db = getDb();
    const [existing] = await withDbRetry(() =>
      db
        .select({ id: subscriptionPlans.id })
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.slug, slug))
        .limit(1)
    );
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          message: `[Field 'slug', Code: duplicate] A plan with slug '${slug}' already exists`,
          code: 'CONFLICT',
        },
        { status: 409 }
      );
    }

    const [created] = await withDbRetry(() =>
      db
        .insert(subscriptionPlans)
        .values({
          slug,
          name,
          // String straight into decimal(15,2); no float round-trip.
          priceMonthly,
          maxUsers,
          isActive: isActive ?? true,
        })
        .returning()
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'PLAN_CREATE',
      targetType: 'SubscriptionPlan',
      targetId: created!.id,
      details: { slug, name, priceMonthly, maxUsers },
    });

    return NextResponse.json(
      { success: true, data: created, message: 'Plan created' },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('[PLAN CREATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to create plan', code: 'PLAN_CREATE_FAILED' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'id', Code: invalid_type] id is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const parsed = planUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(fieldError(parsed.error), { status: 400 });
    }

    const db = getDb();
    const [existing] = await withDbRetry(() =>
      db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id)).limit(1)
    );
    if (!existing) {
      return NextResponse.json(
        { success: false, message: 'Plan not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { name, priceMonthly, maxUsers, isActive } = parsed.data;
    const [updated] = await withDbRetry(() =>
      db
        .update(subscriptionPlans)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(priceMonthly !== undefined ? { priceMonthly } : {}),
          ...(maxUsers !== undefined ? { maxUsers } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(subscriptionPlans.id, id))
        .returning()
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'PLAN_UPDATE',
      targetType: 'SubscriptionPlan',
      targetId: id,
      details: {
        slug: existing.slug,
        from: {
          name: existing.name,
          priceMonthly: existing.priceMonthly,
          maxUsers: existing.maxUsers,
          isActive: existing.isActive,
        },
        to: { name, priceMonthly, maxUsers, isActive },
      },
    });

    return NextResponse.json({ success: true, data: updated, message: 'Plan updated' });
  } catch (error: unknown) {
    console.error('[PLAN UPDATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to update plan', code: 'PLAN_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/plans?id=… — retire a plan.
 *
 * A plan that any tenant still points at is NOT deletable: removing the row
 * would leave those subscriptions with a dangling plan and the billing screen
 * blank. Retire it (isActive = false) instead; the PATCH route handles that.
 */
export async function DELETE(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'id', Code: invalid_type] id is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const [inUse] = await withDbRetry(() =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.planId, id))
    );

    if (Number(inUse?.count ?? 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Cannot delete: ${inUse?.count} tenant(s) are still on this plan. Deactivate it instead.`,
          code: 'PLAN_IN_USE',
        },
        { status: 409 }
      );
    }

    const [deleted] = await withDbRetry(() =>
      db
        .delete(subscriptionPlans)
        .where(eq(subscriptionPlans.id, id))
        .returning({ id: subscriptionPlans.id, slug: subscriptionPlans.slug })
    );
    if (!deleted) {
      return NextResponse.json(
        { success: false, message: 'Plan not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'PLAN_UPDATE',
      targetType: 'SubscriptionPlan',
      targetId: id,
      details: { deleted: true, slug: deleted.slug },
    });

    return NextResponse.json({ success: true, message: 'Plan deleted' });
  } catch (error: unknown) {
    console.error('[PLAN DELETE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to delete plan', code: 'PLAN_DELETE_FAILED' },
      { status: 500 }
    );
  }
}
