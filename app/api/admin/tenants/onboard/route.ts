import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, systemSettings, tenantSubscriptions, subscriptionPlans, subscriptionChangeLog } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { AuthError, ForbiddenError, ConflictError, AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { validatePasswordStrength } from '@/lib/utils/password';
import { normalizeEmail } from '@/lib/utils/types';
import { logSuperAdminAction } from '@/lib/superadmin-service';

const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

// POST /api/admin/tenants/onboard — platform-only.
// Creates tenant + org-admin user + settings row + subscription in one
// transaction. The org admin is role Admin: full power inside their tenant,
// locked out of /api/admin (requires SuperAdmin).
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

    const email = normalizeEmail(adminEmail);
    const strength = validatePasswordStrength(adminPassword);
    if (!strength.valid) {
      return NextResponse.json(
        { success: false, message: strength.message, code: 'WEAK_PASSWORD' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [slugTaken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (slugTaken) throw new ConflictError('A tenant with this slug already exists');

    const [emailTaken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (emailTaken) throw new ConflictError('A user with this email already exists');

    const [planRow] = plan
      ? await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).where(eq(subscriptionPlans.slug, plan)).limit(1)
      : [];
    if (plan && !planRow) throw new ConflictError(`Unknown subscription plan: ${plan}`);

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const perms: Record<string, string> = Object.fromEntries(ALL_SCREENS.map((s) => [s, 'WRITE']));
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ slug, name, plan, maxUsers, status: 'active', isMaintenanceMode: false }).returning();
      if (!tenant) throw new AppError('Failed to create tenant', 500);

      const [admin] = await tx.insert(users).values({
        tenantId: tenant.id,
        name: adminName || 'Organization Admin',
        email,
        password: passwordHash,
        role: 'Admin',
        status: 'active',
        permissions: perms,
      }).returning({ id: users.id, email: users.email });
      if (!admin) throw new AppError('Failed to create tenant admin', 500);

      await tx.insert(systemSettings).values({ tenantId: tenant.id, companyName: name });
      await tx.insert(tenantSubscriptions).values({
        tenantId: tenant.id,
        planId: planRow?.id ?? null,
        status: 'trial',
        trialEndsAt: new Date(now.getTime() + 14 * 24 * 3600_000),
      });
      await tx.insert(subscriptionChangeLog).values({
        tenantId: tenant.id,
        actorUserId: platformUser.id,
        actorEmail: platformUser.email,
        action: 'TENANT_ONBOARDED',
        toPlanId: planRow?.id ?? null,
        toStatus: 'trial',
        reason: 'Onboarded via /api/admin/tenants/onboard',
      });
      return { tenant, admin };
    });

    await logSuperAdminAction({
      context: { adminUserId: platformUser.id, adminEmail: platformUser.email },
      actionType: 'TENANT_ONBOARD',
      targetType: 'Tenant',
      targetId: result.tenant.id,
      tenantId: result.tenant.id,
      details: { slug, plan },
    });

    return NextResponse.json(
      { success: true, data: { tenantId: result.tenant.id, slug, adminEmail: result.admin.email }, message: 'Tenant onboarded successfully' },
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
