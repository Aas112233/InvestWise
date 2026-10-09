import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, tenantSubscriptions, subscriptionChangeLog } from '@/db/schema/index';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { AppError, AuthError, ForbiddenError, NotFoundError, ConflictError, readJsonBody } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { logSuperAdminAction } from '@/lib/superadmin-service';
import { getClientIp } from '@/lib/request-meta';

// Mirrors lib/tenant-provision: a platform-created tenant starts on the same
// 14-day trial as the onboard route, so it is never sweep-invisible.
const ONBOARD_TRIAL_DAYS = 14;

interface TenantResponse {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  isMaintenanceMode: boolean;
  maxUsers: number;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
}

function toTenantResponse(row: Record<string, unknown>, userCount?: number): TenantResponse {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    status: row.status as string,
    plan: row.plan as string,
    isMaintenanceMode: Boolean(row.isMaintenanceMode),
    maxUsers: Number(row.maxUsers || 100),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
    userCount,
  };
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const skip = (page - 1) * limit;
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    const db = getDb();

    const conditions = [];
    if (search) {
      conditions.push(
        (eq(tenants.name, search) as any)
      );
    }
    if (status) {
      conditions.push(eq(tenants.status, status));
    }

    const whereClause = conditions.length > 0 ? conditions[0] : undefined;

    const [totalResult, tenantRows] = await Promise.all([
      db.select({ count: count() }).from(tenants).where(whereClause),
      db
        .select()
        .from(tenants)
        .where(whereClause)
        .orderBy(desc(tenants.createdAt))
        .limit(limit)
        .offset(skip),
    ]);

    const tenantIds = tenantRows.map(row => row.id).filter((id): id is string => typeof id === 'string');
    const userCounts: Record<string, number> = {};
    if (tenantIds.length > 0) {
      const userCountRows = await db
        .select({ tenantId: users.tenantId, count: count() })
        .from(users)
        .where(inArray(users.tenantId, tenantIds))
        .groupBy(users.tenantId);

      for (const row of userCountRows) {
        if (row.tenantId) {
          userCounts[row.tenantId] = Number(row.count || 0);
        }
      }
    }

    const total = Number(totalResult[0]?.count ?? 0);
    const pages = Math.ceil(total / limit) || 1;

    const data = tenantRows.map(row => toTenantResponse(row, userCounts[row.id as string]));

    return NextResponse.json({
      data,
      meta: {
        total,
        page,
        limit,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
        from: data.length > 0 ? skip + 1 : 0,
        to: skip + data.length,
      },
    });
  } catch (error: any) {
    console.error('[GET TENANTS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get tenants', code: 'TENANTS_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const body = await readJsonBody(request);
    const { slug, name, plan = 'standard', maxUsers = 100 } = body;

    if (!slug || !name) {
      return NextResponse.json(
        { success: false, message: 'Slug and name are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    // Field validation before any write: a non-integer maxUsers used to reach
    // Postgres as a raw value and surface as an opaque 500 (§11).
    if (typeof slug !== 'string' || !/^[a-z0-9-]{2,50}$/.test(slug)) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'slug', Code: invalid_format] Slug must be 2-50 characters, lowercase letters, digits and dashes",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'name', Code: too_long] Name must be a string between 2 and 255 characters",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }
    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 100_000) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'maxUsers', Code: out_of_range] Must be an integer between 1 and 100000",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check for existing slug
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (existing) {
      throw new ConflictError('A tenant with this slug already exists');
    }

    const created = await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name: name.trim(),
          plan,
          maxUsers,
          status: 'active',
          isMaintenanceMode: false,
        })
        .returning();

      if (!tenant) throw new AppError('Failed to create tenant', 500);

      // Subscription row in the same transaction: getTenantSubscriptionBlocked
      // treats a MISSING row as "not blocked", and the expiry sweep only walks
      // existing rows — a tenant created without one was permanently outside
      // billing governance.
      const now = new Date();
      await tx.insert(tenantSubscriptions).values({
        tenantId: tenant.id,
        status: 'trial',
        trialEndsAt: new Date(now.getTime() + ONBOARD_TRIAL_DAYS * 24 * 3600_000),
      });
      await tx.insert(subscriptionChangeLog).values({
        tenantId: tenant.id,
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'SUBSCRIPTION_CHANGE',
        toStatus: 'trial',
        reason: 'Created with tenant via /api/admin/tenants',
      });

      return tenant;
    });

    await logSuperAdminAction({
      context: { adminUserId: user.id, adminEmail: user.email, ipAddress: getClientIp(request) },
      actionType: 'TENANT_CREATE',
      targetType: 'Tenant',
      targetId: created.id,
      tenantId: created.id,
      details: { slug, name: created.name, plan, maxUsers, trialDays: ONBOARD_TRIAL_DAYS },
    });

    return NextResponse.json(
      {
        success: true,
        data: { tenant: toTenantResponse(created) },
        message: 'Tenant created successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[CREATE TENANT ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to create tenant', code: 'TENANT_CREATE_FAILED' },
      { status: 500 }
    );
  }
}