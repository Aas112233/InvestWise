import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, tenants } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';
import { resolveModuleAccess, TENANT_MODULE_KEYS } from '@/lib/tenant-modules';
import { verifyToken } from '@/lib/utils/jwt';
import { COOKIE_NAMES } from '@/lib/utils/cookies';

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

export async function GET(request: NextRequest) {
  try {
    const { user: authUser, tenantId, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;

    const db = getDb();
    const [user] = await db
      .select(USER_SELECT)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    // Support-session flag: the impersonated access token carries
    // impersonatedBy (the platform admin's id). Surfacing it lets the header
    // render the yellow impersonation bar with an exit action. The id itself
    // is already embedded in the audited token, so exposing it changes nothing.
    let impersonatedBy: string | null = null;
    const token = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
    if (token) {
      try {
        impersonatedBy = verifyToken(token, 'access').impersonatedBy ?? null;
      } catch {
        impersonatedBy = null;
      }
    }

    // Tenant module entitlements for client-side UI gating (sidebar + the
    // AppShell 403 gate). Same resolution the API layer uses
    // (lib/tenant-modules resolveModuleAccess) — the client hides what the
    // server refuses; it never GRANTS. SuperAdmin bypasses the module system,
    // so they get a full map.
    let moduleAccess: Record<string, boolean>;
    if (tenantId && !isSuperAdminRole(user.role)) {
      const [tenantRow] = await db
        .select({ moduleAccess: tenants.moduleAccess })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      moduleAccess = resolveModuleAccess(tenantRow?.moduleAccess);
    } else {
      // SuperAdmin bypasses the module system (server-side too) — grant every
      // key so no default-off module (analysis) hides from their sidebar.
      moduleAccess = Object.fromEntries(TENANT_MODULE_KEYS.map((k) => [k, true]));
    }

    return NextResponse.json({ ...toUserResponse(user), impersonatedBy, moduleAccess });
  } catch (error: any) {
    console.error('[GET PROFILE ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get profile', code: 'PROFILE_FAILED' },
      { status: 500 }
    );
  }
}