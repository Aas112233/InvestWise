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
  sessions,
  blacklistedTokens,
  loginAttempts,
  deletedRecords,
} from '@/db/schema/index';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { SignOptions } from 'jsonwebtoken';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

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
  /** Manual override of the paid-through instant. */
  currentPeriodEnd?: Date | null;
  /** Manual override of the trial deadline. */
  trialEndsAt?: Date | null;
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
    const patch = {
      ...(toPlanId !== undefined ? { planId: toPlanId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.graceEndsAt !== undefined ? { graceEndsAt: params.graceEndsAt } : {}),
      ...(params.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: params.currentPeriodEnd }
        : {}),
      ...(params.trialEndsAt !== undefined ? { trialEndsAt: params.trialEndsAt } : {}),
      updatedAt: now,
    };

    if (current) {
      await tx
        .update(tenantSubscriptions)
        .set(patch)
        .where(eq(tenantSubscriptions.tenantId, params.tenantId));
    } else {
      await tx.insert(tenantSubscriptions).values({
        tenantId: params.tenantId,
        planId: toPlanId ?? null,
        status: params.status ?? 'active',
        ...(params.graceEndsAt !== undefined ? { graceEndsAt: params.graceEndsAt } : {}),
        ...(params.currentPeriodEnd !== undefined
          ? { currentPeriodEnd: params.currentPeriodEnd }
          : {}),
        ...(params.trialEndsAt !== undefined ? { trialEndsAt: params.trialEndsAt } : {}),
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
      metadata: {
        currentPeriodEnd:
          (params.currentPeriodEnd ?? current?.currentPeriodEnd)?.toISOString() ?? null,
        trialEndsAt: (params.trialEndsAt ?? current?.trialEndsAt)?.toISOString() ?? null,
        graceEndsAt: (params.graceEndsAt ?? current?.graceEndsAt)?.toISOString() ?? null,
      },
    });

    await tx.insert(superAdminActionLog).values({
      adminUserId: context.adminUserId,
      adminEmail: context.adminEmail,
      actionType: 'SUBSCRIPTION_CHANGE',
      targetType: 'Tenant',
      targetId: params.tenantId,
      tenantId: params.tenantId,
      details: {
        toPlan: params.planSlug ?? null,
        toStatus: params.status ?? null,
        reason: params.reason ?? null,
        currentPeriodEnd: (params.currentPeriodEnd ?? current?.currentPeriodEnd)?.toISOString() ?? null,
        trialEndsAt: (params.trialEndsAt ?? current?.trialEndsAt)?.toISOString() ?? null,
        graceEndsAt: (params.graceEndsAt ?? current?.graceEndsAt)?.toISOString() ?? null,
      } as unknown as Record<string, unknown>,
      ipAddress: context.ipAddress ?? null,
    });
  });
}

export interface ExpirySweepResult {
  scanned: number;
  expired: number;
  trialsExpired: number;
}

/**
 * Auto-expiry engine. Walks every subscription and:
 *  - a TRIAL past trialEndsAt (or currentPeriodEnd when no trial date is set)
 *    becomes EXPIRED;
 *  - an ACTIVE subscription past currentPeriodEnd becomes PAST_DUE, and if it
 *    is also past graceEndsAt becomes EXPIRED.
 *
 * Idempotent: a second run over the same state changes nothing and reports
 * zero transitions, so a retried or duplicated cron invocation is safe.
 * Every transition writes a change log and a platform audit row.
 */
export async function evaluateSubscriptionExpiry(
  context: SuperAdminContext = { adminUserId: null, adminEmail: 'system@investwise.cron' },
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  const db = getDb();
  const rows = await db
    .select({
      id: tenantSubscriptions.id,
      tenantId: tenantSubscriptions.tenantId,
      status: tenantSubscriptions.status,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      trialEndsAt: tenantSubscriptions.trialEndsAt,
      graceEndsAt: tenantSubscriptions.graceEndsAt,
      tenantName: tenants.name,
    })
    .from(tenantSubscriptions)
    .leftJoin(tenants, eq(tenants.id, tenantSubscriptions.tenantId))
    .where(inArray(tenantSubscriptions.status, ['trial', 'active', 'past_due']));

  let expired = 0;
  let trialsExpired = 0;

  for (const row of rows) {
    const trialDeadline = row.trialEndsAt ?? row.currentPeriodEnd;
    let nextStatus: string | null = null;
    let nextGrace: Date | null | undefined;

    if (row.status === 'trial') {
      if (trialDeadline && trialDeadline.getTime() <= now.getTime()) {
        nextStatus = 'expired';
        trialsExpired += 1;
      }
    } else if (row.status === 'active' || row.status === 'past_due') {
      const periodEnd = row.currentPeriodEnd;
      if (periodEnd && periodEnd.getTime() <= now.getTime()) {
        if (row.graceEndsAt && row.graceEndsAt.getTime() <= now.getTime()) {
          nextStatus = 'expired';
        } else {
          nextStatus = 'past_due';
          // Grace runs from the period end, so a fresh non-payment starts its
          // window rather than inheriting a stale (already elapsed) date.
          nextGrace = row.graceEndsAt ?? new Date(periodEnd.getTime() + 7 * 86_400_000);
        }
      }
    }

    if (!nextStatus) continue;

    const wasStatus = row.status;
    await db.transaction(async (tx) => {
      await tx
        .update(tenantSubscriptions)
        .set({
          status: nextStatus as string,
          ...(nextGrace !== undefined ? { graceEndsAt: nextGrace } : {}),
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, row.id));

      await tx.insert(subscriptionChangeLog).values({
        tenantId: row.tenantId,
        actorUserId: null,
        actorEmail: context.adminEmail,
        action: 'AUTO_EXPIRY',
        fromStatus: wasStatus,
        toStatus: nextStatus as string,
        reason: 'Automated subscription expiry sweep',
        metadata: {
          periodEnd: row.currentPeriodEnd?.toISOString() ?? null,
          trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
          graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
        },
      });

      await tx.insert(superAdminActionLog).values({
        adminUserId: null,
        adminEmail: context.adminEmail,
        actionType: 'SUBSCRIPTION_EXPIRY',
        targetType: 'Tenant',
        targetId: row.tenantId,
        tenantId: row.tenantId,
        details: {
          tenantName: row.tenantName ?? null,
          from: wasStatus,
          to: nextStatus,
        } as unknown as Record<string, unknown>,
        ipAddress: null,
      });
    });

    if (nextStatus === 'expired') expired += 1;
  }

  return { scanned: rows.length, expired, trialsExpired };
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

  // Delete order is load-bearing: every tenant_id FK is ON DELETE NO ACTION
  // (0001_multitenant_foundation.sql), so children must leave before parents.
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

    // Auth/telemetry rows have no tenant_id but do reference users.id with no
    // cascade, so they are scoped by the tenant's own users and removed first.
    const tenantUserRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenantId));
    const tenantUserIds = tenantUserRows.map((row) => row.id);
    if (tenantUserIds.length > 0) {
      await tx.delete(sessions).where(inArray(sessions.userId, tenantUserIds));
      await tx.delete(blacklistedTokens).where(inArray(blacklistedTokens.userId, tenantUserIds));
      await tx.delete(loginAttempts).where(inArray(loginAttempts.userId, tenantUserIds));
      await tx.delete(deletedRecords).where(inArray(deletedRecords.deletedBy, tenantUserIds));
      // actor_user_id also points at users with no cascade: leave before them.
      await tx
        .delete(subscriptionChangeLog)
        .where(inArray(subscriptionChangeLog.actorUserId, tenantUserIds));
      // Platform audit rows must outlive the wipe, but their FKs are NO ACTION:
      // detach the ids (adminEmail / details keep the attribution provable).
      await tx
        .update(superAdminActionLog)
        .set({ adminUserId: null })
        .where(inArray(superAdminActionLog.adminUserId, tenantUserIds));
    }

    await tx.delete(users).where(eq(users.tenantId, tenantId));
    await tx.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId));
    await tx.delete(subscriptionChangeLog).where(eq(subscriptionChangeLog.tenantId, tenantId));
    // Same for the tenant-side audit FKs (TENANT_ONBOARD, SUBSCRIPTION_CHANGE,
    // MODULE_ACCESS_CHANGE rows) — null the tenant_id, keep the history.
    await tx
      .update(superAdminActionLog)
      .set({ tenantId: null })
      .where(eq(superAdminActionLog.tenantId, tenantId));
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

export interface DeletedUserSummary {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
}

/**
 * Remove one login account from the platform without touching the money.
 *
 * The account and the records it produced are different things. Deleting the
 * row must never cascade into the ledger, so this does what the tenant wipe
 * does and what Postgres forces anyway: every user_id FK in this schema is
 * ON DELETE NO ACTION, so history is kept by detaching the pointer, not by
 * deleting the row. Attribution stays provable because the human-readable
 * snapshots (`users.email`, `audit_logs.user_name`, `admin_email`,
 * `actor_email`) live beside those FKs and are not removed.
 *
 * Three guards, each preventing an unrecoverable state:
 *  - an operator cannot delete the account they are signed in as;
 *  - the last active platform operator cannot be removed (locks the panel);
 *  - the last active administrator of a tenant cannot be removed while still
 *    active (locks the customer out of their own org, and the panel has no
 *    user-create endpoint to recover them with).
 */
export async function deleteUserAccount(
  userId: string,
  context: SuperAdminContext,
): Promise<DeletedUserSummary> {
  const db = getDb();
  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      tenantId: users.tenantId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new NotFoundError('User');

  if (context.adminUserId && target.id === context.adminUserId) {
    throw new ForbiddenError(
      'You cannot delete the account you are signed in as. Hand the platform over to another operator first.',
    );
  }

  const targetIsOperator = isSuperAdminRole(target.role) || isPlatformOwnerEmail(target.email);
  if (targetIsOperator) {
    const operators = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, 'SuperAdmin'), eq(users.status, 'active')));
    const remaining = operators.filter((u) => u.id !== target.id && !isPlatformOwnerEmail(u.email));
    if (remaining.length === 0) {
      throw new ConflictError(
        'Cannot delete the last active platform operator — the admin panel would become permanently unreachable.',
      );
    }
  }

  // Role is matched through normalizeRole rather than a SQL equality: legacy
  // spellings ('administrator') still exist in rows written before 0002.
  if (target.tenantId && target.status === 'active' && normalizeRole(target.role) === 'Admin') {
    const accounts = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.tenantId, target.tenantId));
    const hasPeer = accounts.some(
      (a) => a.id !== target.id && a.status === 'active' && normalizeRole(a.role) === 'Admin',
    );
    if (!hasPeer) {
      throw new ConflictError(
        `${target.email} is the only active administrator in this tenant. Promote another user to Admin before deleting this account.`,
      );
    }
  }

  await db.transaction(async (tx) => {
    // Rows that exist only to serve the sign-in itself die with the account.
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(blacklistedTokens).where(eq(blacklistedTokens.userId, userId));
    await tx.delete(loginAttempts).where(eq(loginAttempts.userId, userId));
    // goals.user_id is NOT NULL, so a goal cannot outlive its owner.
    await tx.delete(goals).where(eq(goals.userId, userId));

    // Everything else is business or compliance history: detach, never delete.
    await tx
      .update(transactions)
      .set({ createdBy: null, updatedBy: null, authorizedBy: null, deletedBy: null })
      .where(
        or(
          eq(transactions.createdBy, userId),
          eq(transactions.updatedBy, userId),
          eq(transactions.authorizedBy, userId),
          eq(transactions.deletedBy, userId),
        ),
      );
    await tx
      .update(meetings)
      .set({ createdBy: null, updatedBy: null, conductedBy: null })
      .where(
        or(
          eq(meetings.createdBy, userId),
          eq(meetings.updatedBy, userId),
          eq(meetings.conductedBy, userId),
        ),
      );
    // Deliberately split from the audit columns below: hasUserAccess tracks
    // user_id, so it may only be cleared on the row that actually loses its
    // account. A member whose creator is being deleted keeps its own login.
    await tx
      .update(members)
      .set({ userId: null, hasUserAccess: false })
      .where(eq(members.userId, userId));
    await tx
      .update(members)
      .set({ createdBy: null, updatedBy: null })
      .where(or(eq(members.createdBy, userId), eq(members.updatedBy, userId)));
    await tx
      .update(memberPenalties)
      .set({ issuedBy: null, waivedBy: null })
      .where(or(eq(memberPenalties.issuedBy, userId), eq(memberPenalties.waivedBy, userId)));
    await tx
      .update(fiscalPeriods)
      .set({ closedBy: null })
      .where(eq(fiscalPeriods.closedBy, userId));
    await tx
      .update(profitAllocations)
      .set({ allocatedBy: null })
      .where(eq(profitAllocations.allocatedBy, userId));
    await tx
      .update(systemSettings)
      .set({ lastUpdatedBy: null })
      .where(eq(systemSettings.lastUpdatedBy, userId));
    await tx.update(auditLogs).set({ userId: null }).where(eq(auditLogs.userId, userId));
    await tx
      .update(deletedRecords)
      .set({ deletedBy: null })
      .where(eq(deletedRecords.deletedBy, userId));
    await tx
      .update(subscriptionChangeLog)
      .set({ actorUserId: null })
      .where(eq(subscriptionChangeLog.actorUserId, userId));
    await tx
      .update(superAdminActionLog)
      .set({ adminUserId: null })
      .where(eq(superAdminActionLog.adminUserId, userId));

    await tx.delete(users).where(eq(users.id, userId));

    // The snapshot is recorded because the row it describes no longer exists:
    // after this transaction the audit entry is the only proof of the account.
    await tx.insert(superAdminActionLog).values({
      adminUserId: context.adminUserId,
      adminEmail: context.adminEmail,
      actionType: 'USER_DELETE',
      targetType: 'User',
      targetId: target.id,
      tenantId: target.tenantId ?? null,
      details: {
        email: target.email,
        role: normalizeRole(target.role),
        status: target.status ?? null,
        ledgerRetained: true,
      } as unknown as Record<string, unknown>,
      ipAddress: context.ipAddress ?? null,
    });
  });

  return {
    id: target.id,
    email: target.email,
    role: normalizeRole(target.role),
    tenantId: target.tenantId ?? null,
  };
}

// Short-lived support session: a token pair for the TARGET user carrying
// impersonatedBy = the platform admin. getAuthContext() scopes by the target
// tenant while retaining original-admin attribution for audit.
//
// Both tokens are minted, not just the access token: the browser refreshes
// accessToken from refreshToken when it expires, so swapping only the access
// cookie would silently restore the PLATFORM ADMIN mid-session and end the
// impersonation without anyone noticing. A full pair keeps the session
// coherently the target user for its full 30 minutes.
export const IMPERSONATION_TOKEN_TTL: NonNullable<SignOptions['expiresIn']> = '30m';

export interface ImpersonationSession {
  accessToken: string;
  refreshToken: string;
  tenantId: string | null;
  email: string;
  targetUserId: string;
}

export async function issueImpersonationSession(
  admin: { id: string; email: string },
  targetUserId: string,
): Promise<ImpersonationSession> {
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

  const claims = {
    role: normalizeRole(target.role),
    email: target.email,
    tenantId: target.tenantId ?? null,
    subscriptionBlocked: false,
    impersonatedBy: admin.id,
  };
  return {
    accessToken: generateAccessToken(target.id, claims, IMPERSONATION_TOKEN_TTL),
    refreshToken: generateRefreshToken(target.id),
    tenantId: target.tenantId ?? null,
    email: target.email,
    targetUserId: target.id,
  };
}
