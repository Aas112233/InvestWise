import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { tenants } from '@/db/schema/index';
import { asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import {
  TENANT_MODULE_DEFINITIONS,
  defaultModuleAccess,
  resolveModuleAccess,
  validateModuleAccessPatch,
} from '@/lib/tenant-modules';
import { logSuperAdminAction } from '@/lib/superadmin-service';

interface TenantEntitlementRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  moduleAccess: Record<string, boolean>;
}

/**
 * GET /api/admin/feature-flags — entitlement matrix for every tenant.
 * `search` matches tenant name or slug.
 */
export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim();

    const filters: SQL[] = [];
    if (search) {
      filters.push(or(ilike(tenants.name, `%${search}%`), ilike(tenants.slug, `%${search}%`))!);
    }

    const rows = await withDbRetry(() =>
      getDb()
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          plan: tenants.plan,
          moduleAccess: tenants.moduleAccess,
        })
        .from(tenants)
        .where(filters.length ? or(...filters)! : undefined)
        .orderBy(asc(tenants.name))
    );

    const data: TenantEntitlementRow[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status || 'active',
      plan: r.plan,
      moduleAccess: resolveModuleAccess(r.moduleAccess),
    }));

    return NextResponse.json({
      success: true,
      data: {
        tenants: data,
        defaults: defaultModuleAccess(),
        definitions: TENANT_MODULE_DEFINITIONS,
      },
    });
  } catch (error: unknown) {
    console.error('[FEATURE FLAGS LIST ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load module entitlements', code: 'FEATURE_FLAGS_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/feature-flags { tenantId, moduleAccess } — platform-only.
 *
 * The patch is merged over the tenant's RESOLVED map, not over the raw jsonb,
 * so a partial patch can never silently drop the modules it does not mention.
 * Required modules are rejected rather than coerced, and the change is written
 * to super_admin_action_log with a before/after diff.
 */
export async function PUT(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const { tenantId, moduleAccess } = (body ?? {}) as {
      tenantId?: string;
      moduleAccess?: unknown;
    };

    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'tenantId', Code: invalid_type] tenantId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const parsed = validateModuleAccessPatch(moduleAccess);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message, code: parsed.code },
        { status: 400 }
      );
    }

    const db = getDb();
    const [target] = await withDbRetry(() =>
      db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          moduleAccess: tenants.moduleAccess,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    );
    if (!target) {
      return NextResponse.json(
        { success: false, message: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const before = resolveModuleAccess(target.moduleAccess);
    const after = { ...before, ...parsed.value };

    const [updated] = await withDbRetry(() =>
      db
        .update(tenants)
        .set({ moduleAccess: after, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id, moduleAccess: tenants.moduleAccess })
    );

    const changed = Object.keys(parsed.value).filter((k) => before[k] !== parsed.value[k as never]);

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'MODULE_ACCESS_CHANGE',
      targetType: 'Tenant',
      targetId: tenantId,
      tenantId,
      details: {
        tenantName: target.name,
        tenantSlug: target.slug,
        changed: changed.map((k) => ({ module: k, from: before[k], to: after[k] })),
      },
    });

    return NextResponse.json({
      success: true,
      data: { id: updated!.id, moduleAccess: resolveModuleAccess(updated!.moduleAccess) },
      message: 'Module entitlements updated',
    });
  } catch (error: unknown) {
    console.error('[FEATURE FLAGS UPDATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to update module entitlements', code: 'FEATURE_FLAGS_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}
