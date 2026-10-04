import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { users, tenants } from '@/db/schema/index';
import { desc, count, ilike, or, eq, and, type SQL } from 'drizzle-orm';
import { AuthError, ForbiddenError, AppError, extractDbError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import { ROLES, normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { validatePasswordStrength, hashPassword } from '@/lib/utils/password';
import { validateUserUpdateInput, validatePasswordResetInput } from '@/lib/admin/user-schema';
import { logSuperAdminAction, deleteUserAccount } from '@/lib/superadmin-service';

const MAX_LIMIT = 100;

/**
 * Cross-tenant user directory. Platform-only (AGENTS.md §6: SuperAdmin bypasses
 * tenant scope ONLY under /api/admin). Supports a cross-tenant search so a
 * locked-out customer can actually be found and fixed.
 *
 * `impersonatable=true` narrows to users a support session may target:
 * platform operators are excluded, since impersonating one would let a
 * compromised admin panel escalate.
 */
export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    const search = (searchParams.get('search') || '').trim();
    const tenantId = (searchParams.get('tenantId') || '').trim();
    const role = (searchParams.get('role') || '').trim();
    const status = (searchParams.get('status') || '').trim();
    const impersonatable = searchParams.get('impersonatable') === 'true';

    const db = getDb();
    const filters: SQL[] = [];

    if (search) {
      filters.push(
        or(
          ilike(users.name, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.role, `%${search}%`)
        )!
      );
    }
    if (tenantId) filters.push(eq(users.tenantId, tenantId));
    if (role) filters.push(eq(users.role, role));
    if (status) filters.push(eq(users.status, status));

    // Post-filter for platform operators rather than pushing it into SQL: the
    // allowlist lives in env, not the database, so it cannot be a where-clause.
    let rows = await withDbRetry(() =>
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          status: users.status,
          tenantId: users.tenantId,
          lastLogin: users.lastLogin,
          createdAt: users.createdAt,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
        })
        .from(users)
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(users.createdAt))
        .limit(impersonatable ? limit * 4 : limit)
        .offset(skip)
    );

    if (impersonatable) {
      rows = rows
        .filter((r) => !isSuperAdminRole(r.role) && !isPlatformOwnerEmail(r.email))
        .slice(0, limit);
    }

    // Count needs the same filters. Skipped only for the impersonatable case,
    // where the env allowlist makes an exact SQL count impossible without the
    // full row set.
    let total = rows.length;
    if (!impersonatable) {
      const [totalResult] = await withDbRetry(() =>
        db
          .select({ count: count() })
          .from(users)
          .where(filters.length ? and(...filters) : undefined)
      );
      total = Number(totalResult?.count ?? 0);
    }

    const data = rows.map((r) => ({
      id: r.id,
      fullName: r.name,
      email: r.email,
      role: normalizeRole(r.role),
      rawRole: r.role,
      status: r.status || 'active',
      tenantId: r.tenantId,
      tenantName: r.tenantName ?? null,
      tenantSlug: r.tenantSlug ?? null,
      lastLoginAt: r.lastLogin instanceof Date ? r.lastLogin.toISOString() : null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
      impersonatable: !isSuperAdminRole(r.role) && !isPlatformOwnerEmail(r.email),
    }));

    return NextResponse.json({
      success: true,
      data,
      roles: ROLES,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error: unknown) {
    console.error('[ADMIN USERS LIST ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to list users', code: 'USERS_LIST_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users?userId=… — platform-only mutation of a tenant user.
 * Guard rails that matter:
 *  - cannot demote or deactivate the LAST active platform operator, which would
 *    lock everyone out of the admin panel permanently;
 *  - cannot change a platform operator's own role/status while acting as them;
 *  - every change is written to super_admin_action_log.
 */
export async function PATCH(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'userId', Code: invalid_type] userId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = validateUserUpdateInput(body);
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
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          status: users.status,
          tenantId: users.tenantId,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    );
    if (!target) {
      return NextResponse.json(
        { success: false, message: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const { role, status, name } = parsed.value;
    const targetIsOperator = isSuperAdminRole(target.role) || isPlatformOwnerEmail(target.email);
    const losingOperator = role !== undefined && normalizeRole(role) !== 'SuperAdmin';
    const deactivating = status !== undefined && status !== 'active';

    if (targetIsOperator && (losingOperator || deactivating)) {
      const activeOperators = await withDbRetry(() =>
        db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(eq(users.role, 'SuperAdmin'), eq(users.status, 'active')))
      );
      const remaining = activeOperators.filter(
        (u) => u.id !== target.id && !isPlatformOwnerEmail(u.email)
      );
      if (remaining.length === 0) {
        return NextResponse.json(
          {
            success: false,
            message:
              "[Field 'role', Code: last_superadmin] Cannot demote or deactivate the last active platform operator",
            code: 'LAST_SUPERADMIN',
          },
          { status: 409 }
        );
      }
    }

    const [updated] = await withDbRetry(() =>
      db
        .update(users)
        .set({
          ...(role !== undefined ? { role: normalizeRole(role) } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(name !== undefined ? { name: name.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          status: users.status,
        })
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'USER_UPDATE',
      targetType: 'User',
      targetId: userId,
      tenantId: target.tenantId,
      details: {
        targetEmail: target.email,
        from: { role: target.role, status: target.status },
        to: { role: updated?.role, status: updated?.status },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated!.id,
        fullName: updated!.name,
        email: updated!.email,
        role: normalizeRole(updated!.role),
        status: updated!.status,
      },
      message: 'User updated',
    });
  } catch (error: unknown) {
    console.error('[ADMIN USER UPDATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to update user', code: 'USER_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users?userId=… { password } — platform-only password reset.
 * A locked-out tenant admin is otherwise unrecoverable without a direct DB
 * write. The action is audit-logged separately from USER_UPDATE so a credential
 * change is always distinguishable from a profile edit.
 */
export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'userId', Code: invalid_type] userId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const parsed = validatePasswordResetInput(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message, code: parsed.code },
        { status: 400 }
      );
    }

    const strength = validatePasswordStrength(parsed.value.password);
    if (!strength.valid) {
      return NextResponse.json(
        {
          success: false,
          message: `[Field 'password', Code: weak_password] ${strength.message}`,
          code: 'WEAK_PASSWORD',
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const [target] = await withDbRetry(() =>
      db
        .select({ id: users.id, email: users.email, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    );
    if (!target) {
      return NextResponse.json(
        { success: false, message: 'User not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const passwordHash = await hashPassword(parsed.value.password);
    await withDbRetry(() =>
      db
        .update(users)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId))
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'USER_PASSWORD_RESET',
      targetType: 'User',
      targetId: userId,
      tenantId: target.tenantId,
      // The password itself is deliberately never recorded.
      details: { targetEmail: target.email },
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset. The user must sign in with the new credential.',
    });
  } catch (error: unknown) {
    console.error('[ADMIN USER PASSWORD RESET ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to reset password', code: 'PASSWORD_RESET_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users?userId=… — platform-only removal of a login account.
 *
 * Deactivating already stops sign-in while keeping everything, so this is
 * deliberately the heavier, irreversible option: the account row goes and its
 * sessions/tokens/goals go with it. The money does not move — deposits,
 * dividends, members and audit history are preserved with the creator pointer
 * nulled (every user_id FK here is ON DELETE NO ACTION, so the alternative to
 * detaching is a 23503 and a dead 500). See deleteUserAccount for the guards.
 */
export async function DELETE(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const userId = new URL(request.url).searchParams.get('userId');
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'userId', Code: invalid_type] userId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const deleted = await deleteUserAccount(userId, {
      adminUserId: platformUser.id || null,
      adminEmail: platformUser.email,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      data: deleted,
      message: 'User deleted',
    });
  } catch (error: unknown) {
    console.error('[ADMIN USER DELETE ERROR]', error);
    // Guard failures come back as 403/404/409 with the real reason attached,
    // never masked as "Something went wrong" (AGENTS.md §11).
    if (error instanceof AppError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    // A FK we did not detach still leaves the account undeletable. Name the
    // constraint instead of returning an opaque 500.
    const db = extractDbError(error);
    if (db.code === '23503') {
      return NextResponse.json(
        {
          success: false,
          message: `Cannot delete user: ${db.message ?? 'a record still references this account'}`,
          code: 'CONFLICT',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to delete user', code: 'USER_DELETE_FAILED' },
      { status: 500 }
    );
  }
}
