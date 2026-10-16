import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { and, count, eq } from 'drizzle-orm';
import {
  AppError,
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  readJsonBody,
} from '@/lib/utils/errors';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { logAudit } from '@/lib/utils/audit';
import { getClientIp } from '@/lib/request-meta';

// Mirrors the screen list in lib/middleware/auth.ts (permission matrix keys).
const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

// Tenant Admins may grant any role EXCEPT the platform role (AGENTS.md §6:
// SuperAdmin is provisioned by the platform only — minting or inheriting it
// through a tenant edit would be privilege escalation).
const TENANT_ASSIGNABLE_ROLES = ['Admin', 'Manager', 'Auditor', 'Member'] as const;
const USER_STATUSES = ['active', 'inactive', 'suspended'] as const;

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    role: z.enum(TENANT_ASSIGNABLE_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    // partialRecord, not record: zod v4's z.record with an enum KEY schema
    // requires every enum key (full record), which would reject a partial
    // per-screen override payload like { DEPOSITS: 'READ' }.
    permissions: z
      .partialRecord(z.enum(ALL_SCREENS as [string, ...string[]]), z.enum(['MANAGE', 'WRITE', 'READ', 'NONE']))
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one of name, role, status or permissions must be provided',
  });

const passwordSchema = z.object({ password: z.string().min(1).max(200) });

function fieldError(issue: z.ZodIssue): ValidationError {
  const field = issue.path.join('.') || 'body';
  return new ValidationError(
    `[Field '${field}', Code: ${issue.code}] ${issue.message}`,
  );
}

// Every mutation resolves the target inside the caller's tenant: a foreign id
// reads as 404, never as someone else's account (AGENTS.md §6).
async function loadTenantTarget(id: string, callerTenantId: string) {
  const db = getDb();
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      permissions: users.permissions,
      tenantId: users.tenantId,
    })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, callerTenantId)))
    .limit(1);
  if (!target) throw new NotFoundError('User');
  // Platform operators must never be manageable from a tenant console, even if
  // a legacy row carries this tenant's id.
  if (isSuperAdminRole(target.role) || isPlatformOwnerEmail(target.email)) {
    throw new ForbiddenError('Platform accounts cannot be managed from tenant screens. Use the admin console instead.');
  }
  return target;
}

/** Admin-only caller check; returns the caller plus their tenant scope. */
async function requireTenantAdmin(request: NextRequest) {
  const { user, tenantId, error } = await getAuthContext(request);
  if (error || !user) {
    return {
      response:
        error ||
        NextResponse.json(
          { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
          { status: 401 },
        ),
    };
  }
  const callerRole = normalizeRole(user.role);
  if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
    throw new ForbiddenError('Admin access required');
  }
  const callerTenantId = requireTenant(tenantId, user);
  return { user, callerTenantId };
}

function errorResponse(error: unknown, fallback: string, fallbackCode: string) {
  console.error('[TENANT USER MUTATION ERROR]', error);
  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, message: error.message, code: error.code },
      { status: error.statusCode },
    );
  }
  return NextResponse.json(
    { success: false, message: fallback, code: fallbackCode },
    { status: 500 },
  );
}

/**
 * PATCH /api/auth/users/[id] { name?, role?, status?, permissions? } —
 * tenant-scoped user management (the /users screen). Guards:
 *  - no self-demotion / self-deactivation (one-click org lockout);
 *  - the tenant's last active Admin cannot be demoted or deactivated;
 *  - SuperAdmin is unassignable and platform rows are untouchable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireTenantAdmin(request);
    if ('response' in admin) return admin.response;

    const { id } = await params;
    const target = await loadTenantTarget(id, admin.callerTenantId);

    const parsed = updateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw fieldError(parsed.error.issues[0]!);
    const { name, role, status, permissions } = parsed.data;

    const demoting = role !== undefined && normalizeRole(target.role) === 'Admin' && role !== 'Admin';
    const deactivating = status !== undefined && status !== 'active';

    if (target.id === admin.user.id && (demoting || deactivating)) {
      throw new ConflictError(
        "[Field 'role', Code: self_demotion] You cannot demote or deactivate your own account. Ask another Admin to make the change.",
      );
    }

    if (demoting || deactivating) {
      if (normalizeRole(target.role) === 'Admin' && target.status === 'active') {
        const db = getDb();
        const [remaining] = await db
          .select({ count: count() })
          .from(users)
          .where(
            and(
              eq(users.tenantId, admin.callerTenantId),
              eq(users.role, 'Admin'),
              eq(users.status, 'active'),
            ),
          );
        if (Number(remaining?.count ?? 0) <= 1) {
          throw new ConflictError(
            "[Field 'role', Code: last_admin] This is the last active Admin in your organization. Promote another user to Admin first.",
          );
        }
      }
    }

    const db = getDb();
    const [updated] = await db
      .update(users)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, target.id), eq(users.tenantId, admin.callerTenantId)))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
        permissions: users.permissions,
      });
    if (!updated) throw new NotFoundError('User');

    await logAudit({
      user: { id: admin.user.id, name: admin.user.name },
      req: { ip: getClientIp(request) ?? undefined },
      tenantId: admin.callerTenantId,
      action: 'UPDATE_USER',
      resourceType: 'User',
      resourceId: updated.id,
      details: {
        targetEmail: target.email,
        from: { role: target.role, status: target.status },
        to: { role: updated.role, status: updated.status },
        permissionsChanged: permissions !== undefined,
      },
      // Zero extra queries: `target` is the row loaded for the guards above;
      // `updated` is the UPDATE's .returning(). Both carry the same
      // permission-relevant fields (no password material either way).
      before: target,
      after: updated,
      status: 'SUCCESS',
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: normalizeRole(updated.role),
        status: updated.status,
        permissions:
          typeof updated.permissions === 'object' && updated.permissions !== null
            ? updated.permissions
            : {},
      },
      message: 'User updated',
    });
  } catch (error) {
    return errorResponse(error, 'Failed to update user', 'USER_UPDATE_FAILED');
  }
}

/**
 * POST /api/auth/users/[id] { password } — Admin-reset credential for a
 * locked-out tenant user. The password itself is never audit-logged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireTenantAdmin(request);
    if ('response' in admin) return admin.response;

    const { id } = await params;
    const target = await loadTenantTarget(id, admin.callerTenantId);

    const parsed = passwordSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw fieldError(parsed.error.issues[0]!);

    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.valid) {
      throw new ValidationError(
        `[Field 'password', Code: weak_password] ${strength.message || 'Password too weak'}`,
      );
    }

    const db = getDb();
    await db
      .update(users)
      .set({ password: await hashPassword(parsed.data.password), updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.tenantId, admin.callerTenantId)));

    await logAudit({
      user: { id: admin.user.id, name: admin.user.name },
      req: { ip: getClientIp(request) ?? undefined },
      tenantId: admin.callerTenantId,
      action: 'USER_PASSWORD_RESET',
      resourceType: 'User',
      resourceId: target.id,
      details: { targetEmail: target.email },
      status: 'SUCCESS',
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset. The user must sign in with the new credential.',
    });
  } catch (error) {
    return errorResponse(error, 'Failed to reset password', 'PASSWORD_RESET_FAILED');
  }
}
