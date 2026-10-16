import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, tenants, users } from '@/db/schema/index';
import { and, count, eq } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { AppError, AuthError, ForbiddenError, ConflictError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  permissions: users.permissions,
  avatar: users.avatar,
  memberId: users.memberId,
  lastLogin: users.lastLogin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

function getDefaultPermissions(role: string): Record<string, string> {
  const perms: Record<string, string> = {};
  const normalized = normalizeRole(role);
  if (normalized === 'SuperAdmin' || normalized === 'Admin') {
    for (const screen of ALL_SCREENS) perms[screen] = 'WRITE';
  } else if (normalized === 'Manager') {
    for (const screen of ALL_SCREENS) perms[screen] = 'READ';
  }
  return perms;
}

function toUserResponse(row: Record<string, unknown>) {
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};

  const role = normalizeRole(row.role);

  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role,
    status: (row.status as string) ?? 'active',
    permissions,
    avatar: (row.avatar as string) ?? null,
    memberId: (row.memberId as string) ?? null,
    lastLogin: row.lastLogin instanceof Date ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user: authUser, tenantId, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    // Fail closed (SEV-005): a user without tenant context must never mint
    // tenant-less accounts — NULL tenantId disables every tenant filter.
    const callerTenantId = requireTenant(tenantId, authUser);
    const userId = authUser.id;
    const callerRole = normalizeRole(authUser.role);

    // Only tenant Admins and platform operators may create users.
    if (callerRole !== 'Admin' && !isSuperAdminRole(callerRole)) {
      throw new ForbiddenError('Admin access required');
    }

    const body = await readJsonBody(request);
    const { name, email, password, role, memberId, memberUuid, permissions } = body;

    // Validation
    if (!name || name.length < 2) {
      throw new ValidationError('Name must be at least 2 characters');
    }
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!password) {
      throw new ValidationError('Password is required');
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.message || 'Invalid password');
    }

    // Permissions payload allowlist (MANAGE/WRITE/READ/NONE per known screen).
    const PERMISSION_VALUES = new Set(['MANAGE', 'WRITE', 'READ', 'NONE']);
    if (permissions !== undefined && permissions !== null) {
      if (typeof permissions !== 'object' || Array.isArray(permissions)) {
        throw new ValidationError(`[Field 'permissions', Code: invalid_type] Permissions must be an object`);
      }
      for (const [screen, level] of Object.entries(permissions as Record<string, unknown>)) {
        if (!ALL_SCREENS.includes(screen)) {
          throw new ValidationError(`[Field 'permissions.${screen}', Code: unknown_screen] Unknown permission screen`);
        }
        if (typeof level !== 'string' || !PERMISSION_VALUES.has(level)) {
          throw new ValidationError(`[Field 'permissions.${screen}', Code: invalid_level] Permission must be MANAGE, WRITE, READ or NONE`);
        }
      }
    }

    const normalizedEmail = normalizeEmail(email);
    const db = getDb();

    // Check for an existing user IN THIS TENANT. Email is unique per tenant
    // (db/migrations/0009), so a global check would wrongly 409 when another
    // organization already has a user with the same address — and would leak
    // that cross-tenant existence through the error.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalizedEmail), eq(users.tenantId, callerTenantId)))
      .limit(1);

    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    // Seat licence enforcement: tenants.maxUsers is the plan cap the platform
    // set at onboarding (or later via billing). Without this check maxUsers was
    // display-only — a tenant on a 5-seat plan could mint unlimited logins.
    // Count includes suspended/inactive logins: they can be reactivated, so
    // they keep occupying their seat.
    const [tenantRow] = await db
      .select({ maxUsers: tenants.maxUsers })
      .from(tenants)
      .where(eq(tenants.id, callerTenantId))
      .limit(1);
    const seatCap = Number(tenantRow?.maxUsers ?? 0);

    const hashed = await hashPassword(password);

    // Platform operators are provisioned via seed/allowlist only — creating a
    // SuperAdmin through this endpoint would be privilege escalation.
    const newRole = normalizeRole(role);
    if (isSuperAdminRole(newRole)) {
      throw new ForbiddenError('SuperAdmin accounts cannot be created from a tenant. Platform operators are managed in the admin console.');
    }

    // The same escalation via a different door: requireSuperAdmin trusts the
    // SUPERADMIN_EMAILS allowlist independently of the stored role, so a
    // tenant Admin who created a row with an allowlisted address would pass
    // every platform gate as an operator while holding only Admin. The role
    // check above cannot catch it — the row would say 'Admin'.
    if (isPlatformOwnerEmail(normalizedEmail)) {
      throw new ForbiddenError('This email address is reserved for platform use');
    }

    // Seat cap, enforced race-free (F-6): the count and the insert run inside
    // one transaction that first locks the tenant row, so concurrent creates
    // for the same tenant serialize on the lock instead of racing the
    // count-then-insert window.
    const created = await db.transaction(async (tx) => {
      await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, callerTenantId))
        .for('update')
        .limit(1);

      if (seatCap > 0) {
        const [seatCount] = await tx
          .select({ count: count() })
          .from(users)
          .where(eq(users.tenantId, callerTenantId))
          .limit(1);
        if (Number(seatCount?.count ?? 0) >= seatCap) {
          throw new ConflictError(
            `[Seat limit reached: ${seatCap} users] Remove a deactivated user or ask the platform operator to raise your plan's user limit.`
          );
        }
      }

      // Member link (optional): resolves a tenant member by uuid (preferred)
      // or MEM-XXXX code, tenant-scoped and live-row only. Rejects members
      // already linked to another login so one member never fans out to two
      // accounts. The member row is claimed inside the same transaction as the
      // user insert, so concurrent creates cannot double-claim it.
      let linkedMember: { id: string; memberId: string; name: string } | null = null;
      const memberLookup = typeof memberUuid === 'string' && memberUuid.trim()
        ? memberUuid.trim()
        : typeof memberId === 'string' && memberId.trim() && !/^\S+@\S+\.\S+$/.test(memberId.trim())
          ? memberId.trim()
          : null;
      if (memberLookup) {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const [memberRow] = await tx
          .select({ id: members.id, memberId: members.memberId, name: members.name, userId: members.userId })
          .from(members)
          .where(
            and(
              eq(members.tenantId, callerTenantId),
              eq(members.isDeleted, false),
              UUID_RE.test(memberLookup) ? eq(members.id, memberLookup) : eq(members.memberId, memberLookup),
            ),
          )
          .limit(1);
        if (!memberRow) {
          throw new ValidationError(`[Field 'memberUuid', Code: not_found] Linked member not found in this organization`);
        }
        if (memberRow.userId) {
          throw new ConflictError(`[Field 'memberUuid', Code: already_linked] ${memberRow.name} is already linked to a login`);
        }
        // Legacy guard: another login may claim the same MEM-XXXX code via the
        // un-FK'd users.member_id varchar.
        const [codeClaim] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, callerTenantId), eq(users.memberId, memberRow.memberId)))
          .limit(1);
        if (codeClaim) {
          throw new ConflictError(`[Field 'memberUuid', Code: already_linked] ${memberRow.name} is already linked to a login`);
        }
        linkedMember = { id: memberRow.id, memberId: memberRow.memberId, name: memberRow.name };
      }

      const [row] = await tx
        .insert(users)
        .values({
          tenantId: callerTenantId,
          name,
          email: normalizedEmail,
          password: hashed,
          role: newRole,
          memberId: linkedMember ? linkedMember.memberId : (typeof memberId === 'string' && memberId.trim() ? memberId.trim() : null),
          permissions: (permissions && Object.keys(permissions).length > 0
            ? permissions
            : getDefaultPermissions(newRole)) as Record<string, string>,
        })
        .returning(USER_SELECT);

      // Claim both directions: users.member_id (legacy varchar code used by
      // delete-guard + sessions) AND members.user_id/has_user_access (uuid FK
      // used by PII masking). Same transaction — never half-linked.
      if (row && linkedMember) {
        await tx
          .update(members)
          .set({ userId: row.id, hasUserAccess: true, updatedAt: new Date() })
          .where(and(eq(members.id, linkedMember.id), eq(members.tenantId, callerTenantId)));
      }
      return row;
    });

    if (!created) {
      throw new AppError('Failed to create user', 500);
    }

    await logAudit({
      action: 'CREATE_USER',
      resourceType: 'User',
      resourceId: created.id,
      details: { createdBy: userId, email: normalizedEmail, role: newRole, memberId: created.memberId ?? null },
      status: 'SUCCESS',
    });

    return NextResponse.json(
      {
        success: true,
        data: { user: toUserResponse(created) },
        message: 'User created successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[REGISTER USER ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError || error instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'User registration failed', code: 'REGISTRATION_FAILED' },
      { status: 500 }
    );
  }
}