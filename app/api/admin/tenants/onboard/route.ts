import { NextRequest, NextResponse } from 'next/server';
import { AuthError, ConflictError, ForbiddenError, AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { logSuperAdminAction } from '@/lib/superadmin-service';
import { provisionTenant } from '@/lib/tenant-provision';

// Platform onboarding hands a 14-day trial and says so in the panel copy
// (admin.tenants.onboardDesc). Self-serve signup uses the operator-set
// platform_settings.default_trial_days instead.
const ONBOARD_TRIAL_DAYS = 14;

// POST /api/admin/tenants/onboard — platform-only.
// Creates tenant + org-admin user + settings row + subscription in one
// transaction via lib/tenant-provision (the same path public self-serve
// signup takes, so the two cannot drift). The org admin is role Admin: full
// power inside their tenant, locked out of /api/admin (requires SuperAdmin).
export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const { slug, name, plan = 'standard', maxUsers = 100, adminName, adminEmail, adminPassword } = body;

    if (!slug || !name || !adminEmail || !adminPassword) {
      return NextResponse.json(
        { success: false, message: 'slug, name, adminEmail and adminPassword are required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const result = await provisionTenant({
      organizationName: name,
      slug,
      adminName: adminName || 'Organization Admin',
      email: adminEmail,
      password: adminPassword,
      plan,
      onUnknownPlan: 'reject',
      maxUsers,
      trialDays: ONBOARD_TRIAL_DAYS,
      actor: { userId: platformUser.id, email: platformUser.email },
      reason: 'Onboarded via /api/admin/tenants/onboard',
    });

    await logSuperAdminAction({
      context: { adminUserId: platformUser.id, adminEmail: platformUser.email },
      actionType: 'TENANT_ONBOARD',
      targetType: 'Tenant',
      targetId: result.tenantId,
      tenantId: result.tenantId,
      details: { slug: result.slug, plan },
    });

    return NextResponse.json(
      {
        success: true,
        data: { tenantId: result.tenantId, slug: result.slug, adminEmail: result.email },
        message: 'Tenant onboarded successfully',
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error('[TENANT ONBOARD ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError || error instanceof AppError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, message: 'Tenant onboarding failed', code: 'TENANT_ONBOARD_FAILED' }, { status: 500 });
  }
}
