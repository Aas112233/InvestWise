import { getDb } from '@/db/index';
import {
  superAdminActionLog,
  tenants,
  users,
  members,
  funds,
  projects,
  projectUpdates,
  transactions,
  meetings,
  meetingAttendees,
  goals,
  profitAllocations,
  memberArrears,
  memberPenalties,
  fiscalPeriods,
  systemSettings,
  auditLogs,
  tenantSubscriptions,
  subscriptionPlans,
  subscriptionChangeLog,
} from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import type { SignOptions } from 'jsonwebtoken';
import { generateAccessToken } from '@/lib/utils/jwt';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';

// Platform control plane (Pathshala-Pro superadmin-service port, trimmed to
// InvestWise needs): action audit, tenant wipe, impersonation issuance,
// subscription transitions. Every mutating helper writes both the domain
// change log and a super_admin_action_log row in one transaction.

export interface SuperAdminContext {
  adminUserId: string | null;
  adminEmail: string;
  ipAddress?: string | null;
}

export const PROTECTED_TENANT_SLUGS = ['default'] as const;

export function isProtectedTenantSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return (PROTECTED_TENANT_SLUGS as readonly string[]).includes(slug);
}

interface LogActionParams {
  context: SuperAdminContext;
  actionType: string;
  targetType?: string;
  targetId?: string;
  tenantId?: string | null;
  details?: unknown;
}

// Fault-tolerant: platform audit must never break the operation it records.
export async function logSuperAdminAction(params: LogActionParams): Promise<void> {
  try {
    const db = getDb();
    await db.insert(superAdminActionLog).values({
      adminUserId: params.context.adminUserId,
      adminEmail: params.context.adminEmail,
      actionType: params.actionType,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      tenantId: params.tenantId ?? null,
      details: (params.details ?? null) as unknown as Record<string, unknown> | null,
      ipAddress: params.context.ipAddress ?? null,
    });
  } catch (error) {
    console.error('SuperAdmin audit log failed:', error);
  }
}

export interface SubscriptionTransition {
  tenantId: string;
  planSlug?: string;
  status?: string;
  reason?: string;
  graceEndsAt?: Date | null;
}

export async function changeTenantSubscription(
  params: SubscriptionTransition,
  context: SuperAdminContext,
): Promise<void> {
  const db = getDb();
  const [current] = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, params.tenantId))
    .limit(1);

  let toPlanId: string | null | undefined;
  if (params.planSlug) {
    const [plan] = await db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.slug, params.planSlug))
      .limit(1);
    if (!plan) throw new Error(`Unknown subscription plan: ${params.planSlug}`);
    toPlanId = plan.id;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(tenantSubscriptions)
        .set({
          ...(toPlanId !== undefined ? { planId: toPlanId } : {}),
          ...(params.status !== undefined ? { status: params.status } : {}),
          ...(params.graceEndsAt !== undefined ? { graceEndsAt: params.graceEndsAt } : {}),
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.tenantId, params.tenantId));
    } else {
      await tx.insert(tenantSubscriptions).values({
        tenantId: params.tenantId,
        planId: toPlanId ?? null,
        status: params.status ?? 'active',
        ...(params.graceEndsAt !== undefined ? { graceEndsAt: params.graceEndsAt } : {}),
      });
    }

    await tx.insert(subscriptionChangeLog).values({
      tenantId: params.tenantId,
      actorUserId: context.adminUserId,
      actorEmail: context.adminEmail,
      action: 'SUBSCRIPTION_CHANGE',
      fromPlanId: current?.planId ?? null,
      toPlanId: toPlanId ?? current?.planId ?? null,
      fromStatus: current?.status ?? null,
      toStatus: params.status ?? current?.status ?? null,
      reason: params.reason ?? null,
    });

    await tx.insert(superAdminActionLog).values({
      adminUserId: context.adminUserId,
      adminEmail: context.adminEmail,
      actionType: 'SUBSCRIPTION_CHANGE',
      targetType: 'Tenant',
      targetId: params.tenantId,
      tenantId: params.tenantId,
      details: { toPlan: params.planSlug ?? null, toStatus: params.status ?? null, reason: params.reason ?? null } as unknown as Record<string, unknown>,
      ipAddress: context.ipAddress ?? null,
    });
  });
}

// Irreversible full wipe of one tenant. Platform (null-tenant) users are
// untouched. The platform audit row keeps tenantId NULL with the slug in
// details, because the tenant FK row is gone in the same transaction.
export async function forceDeleteTenant(tenantId: string, context: SuperAdminContext): Promise<void> {
  const db = getDb();
  const [target] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!target) throw new Error('Tenant not found');
  if (isProtectedTenantSlug(target.slug)) {
    throw new Error(`Tenant '${target.slug}' is protected and cannot be deleted`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(meetingAttendees).where(eq(meetingAttendees.tenantId, tenantId));
    await tx.delete(projectUpdates).where(eq(projectUpdates.tenantId, tenantId));
    await tx.delete(memberArrears).where(eq(memberArrears.tenantId, tenantId));
    await tx.delete(memberPenalties).where(eq(memberPenalties.tenantId, tenantId));
    await tx.delete(profitAllocations).where(eq(profitAllocations.tenantId, tenantId));
    await tx.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
    await tx.delete(transactions).where(eq(transactions.tenantId, tenantId));
    await tx.delete(meetings).where(eq(meetings.tenantId, tenantId));
    await tx.delete(goals).where(eq(goals.tenantId, tenantId));
    await tx.delete(fiscalPeriods).where(eq(fiscalPeriods.tenantId, tenantId));
    await tx.delete(systemSettings).where(eq(systemSettings.tenantId, tenantId));
    await tx.delete(members).where(eq(members.tenantId, tenantId));
    await tx.delete(funds).where(eq(funds.tenantId, tenantId));
    await tx.delete(projects).where(eq(projects.tenantId, tenantId));
    await tx.delete(users).where(eq(users.tenantId, tenantId));
    await tx.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
    await tx.delete(subscriptionChangeLog).where(eq(subscriptionChangeLog.tenantId, tenantId));
    await tx.delete(tenants).where(eq(tenants.id, tenantId));

    await tx.insert(superAdminActionLog).values({
      adminUserId: context.adminUserId,
      adminEmail: context.adminEmail,
      actionType: 'TENANT_FORCE_DELETE',
      targetType: 'Tenant',
      targetId: tenantId,
      tenantId: null,
      details: { tenantSlug: target.slug } as unknown as Record<string, unknown>,
      ipAddress: context.ipAddress ?? null,
    });
  });
}

// Short-lived support session: an access token for the TARGET user carrying
// impersonatedBy = the platform admin. getAuthContext() scopes by the target
// tenant while retaining original-admin attribution for audit.
export const IMPERSONATION_TOKEN_TTL: NonNullable<SignOptions['expiresIn']> = '30m';

export async function issueImpersonationToken(
  admin: { id: string; email: string },
  targetUserId: string,
): Promise<{ token: string; tenantId: string | null; email: string }> {
  const db = getDb();
  const [target] = await db
    .select({ id: users.id, email: users.email, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw new Error('Target user not found');
  // Belt and suspenders: role check plus allowlist, so a not-yet-migrated
  // level-5 row can never be impersonated either.
  if (isSuperAdminRole(target.role) || isPlatformOwnerEmail(target.email)) {
    throw new Error('Cannot impersonate a platform operator');
  }

  const token = generateAccessToken(
    target.id,
    {
      role: normalizeRole(target.role),
      email: target.email,
      tenantId: target.tenantId ?? null,
      subscriptionBlocked: false,
      impersonatedBy: admin.id,
    },
    IMPERSONATION_TOKEN_TTL,
  );
  return { token, tenantId: target.tenantId ?? null, email: target.email };
}
