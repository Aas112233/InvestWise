import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, blacklistedTokens, tenants } from '@/db/schema/index';
import { eq, and, gt } from 'drizzle-orm';
import { verifyToken } from '@/lib/utils/jwt';
import { COOKIE_NAMES } from '@/lib/utils/cookies';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { normalizeRole, isSuperAdminRole, type Role } from '@/lib/roles';
import { hasScreenPermission, hasAnyScreenPermission } from '@/lib/permissions';
import crypto from 'node:crypto';

// In-memory blacklist cache
const blacklistCache = new Map<string, number>();
let blacklistLastSweep = 0;

// Auth hot-path caches (single-process, short TTL).
// Collapses the per-request chain (maintenance + user + tenant lookups) to ~0
// DB hits on hot path. Revocation stays immediate: blacklistToken() evicts the
// cached identity, and logout/refresh/impersonate all funnel through it.
// Status flips (suspend/maintenance) propagate within TTL (30s). Worst case on
// multi-instance (Vercel) is extra DB reads, never a stale grant beyond TTL.
// ponytail: swap to Redis/Upstash if multi-instance hit rate ever matters.
const MAINT_CACHE_TTL_MS = 30_000;
let maintCache: { value: { isMaintenance: boolean; message?: string }; expiresAt: number } | null = null;

const AUTH_CACHE_TTL_MS = 30_000;
let authLastSweep = 0;
// Keyed by sha256(token): never holds raw tokens. Value is the final authed
// identity (post status checks), so hits skip straight to return.
const authCache = new Map<string, { user: AuthenticatedUser; tenant: TenantInfo | null; expiresAt: number }>();

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function blacklistToken(token: string, expiresAt: Date): void {
  const hash = tokenHash(token);
  blacklistCache.set(hash, expiresAt.getTime());
  // Immediate revocation: a logged-out/rotated token must not hit the identity cache.
  authCache.delete(hash);
}

async function isBlacklisted(token: string): Promise<boolean> {
  const hash = tokenHash(token);
  const now = Date.now();

  if (now - blacklistLastSweep > 5 * 60_000) {
    blacklistLastSweep = now;
    for (const [h, exp] of blacklistCache) {
      if (exp < now) blacklistCache.delete(h);
    }
  }

  const cachedExp = blacklistCache.get(hash);
  if (cachedExp !== undefined) {
    return cachedExp > now;
  }

  const db = getDb();
  const rows = await db
    .select({ id: blacklistedTokens.id, expiresAt: blacklistedTokens.expiresAt })
    .from(blacklistedTokens)
    .where(and(eq(blacklistedTokens.token, token), gt(blacklistedTokens.expiresAt, new Date())))
    .limit(1);

  if (rows.length > 0 && rows[0]?.expiresAt) {
    blacklistCache.set(hash, rows[0].expiresAt.getTime());
    return true;
  }

  blacklistCache.set(hash, now - 1);
  return false;
}

export type { Role } from "@/lib/roles";
export type PermissionLevel = "READ" | "WRITE";

const ALL_SCREENS = [
  "DASHBOARD", "MEMBERS", "MEETINGS", "GOVERNANCE", "GOALS", "DEPOSITS", "REQUEST_DEPOSIT",
  "TRANSACTIONS", "DIVIDENDS", "EXPENSES", "PROJECT_MANAGEMENT",
  "FUNDS_MANAGEMENT", "ANALYSIS", "REPORTS", "SETTINGS",
];

// Default explicit grants for users with no stored permission overrides.
// SuperAdmin/Admin: full write. Manager: read baseline (role baseline already
// grants Manager write except SETTINGS; stored READ would only narrow it).
function getDefaultPermissions(role: string): Record<string, string> {
  const perms: Record<string, string> = {};
  const normalized = normalizeRole(role);
  if (normalized === "SuperAdmin" || normalized === "Admin") {
    for (const screen of ALL_SCREENS) perms[screen] = "WRITE";
  } else if (normalized === "Manager") {
    for (const screen of ALL_SCREENS) perms[screen] = "READ";
  }
  return perms;
}

// Public paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
];

// Admin-only paths
const ADMIN_PATHS = [
  '/api/admin',
  '/api/settings',
];

// Maintenance mode check (30s cached: 1 DB hit per 30s instead of per request)
async function checkMaintenanceMode(): Promise<{ isMaintenance: boolean; message?: string }> {
  const now = Date.now();
  if (maintCache && maintCache.expiresAt > now) return maintCache.value;
  let result: { isMaintenance: boolean; message?: string };
  try {
    const db = getDb();
    const [settings] = await db
      .select({ isMaintenanceMode: tenants.isMaintenanceMode })
      .from(tenants)
      .where(eq(tenants.slug, 'default'))
      .limit(1);
    
    if (settings?.isMaintenanceMode) {
      result = { isMaintenance: true, message: 'System is under maintenance. Please try again later.' };
    } else {
      result = { isMaintenance: false };
    }
  } catch {
    // If we can't check, allow through
    result = { isMaintenance: false };
  }
  maintCache = { value: result, expiresAt: now + MAINT_CACHE_TTL_MS };
  return result;
}

// Authentication middleware
export async function authenticateRequest(request: NextRequest): Promise<{
  user: AuthenticatedUser | null;
  tenant: TenantInfo | null;
  error?: NextResponse;
}> {
  const { isMaintenance, message } = await checkMaintenanceMode();
  if (isMaintenance) {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json({ success: false, message }, { status: 503 }),
    };
  }

  // Check for access token in cookies or Authorization header
  let token: string | undefined = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return { user: null, tenant: null };
  }

  // Verify JWT signature first (sync HMAC, free): forged/malformed tokens
  // never touch the DB. Previously the blacklist DB lookup ran first.
  let decoded: { id: string; type: 'access' | 'refresh' };
  try {
    decoded = verifyToken(token, 'access');
  } catch (error) {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: error instanceof Error ? error.message : 'Token verification failed', code: 'TOKEN_INVALID' },
        { status: 401 }
      ),
    };
  }

  // Check blacklist (memory-cached; DB only on first miss per instance)
  if (await isBlacklisted(token)) {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: 'Token has been revoked', code: 'TOKEN_REVOKED' },
        { status: 401 }
      ),
    };
  }

  // Hot-path identity cache: user+tenant snapshot keyed by token hash.
  const hash = tokenHash(token);
  const cacheNow = Date.now();
  if (cacheNow - authLastSweep > 60_000) {
    authLastSweep = cacheNow;
    for (const [h, entry] of authCache) {
      if (entry.expiresAt < cacheNow) authCache.delete(h);
    }
  }
  const cachedIdentity = authCache.get(hash);
  if (cachedIdentity && cachedIdentity.expiresAt > cacheNow) {
    return { user: cachedIdentity.user, tenant: cachedIdentity.tenant };
  }

  // Fetch user
  const db = getDb();
  const userRows = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      permissions: users.permissions,
      lastLogin: users.lastLogin,
      avatar: users.avatar,
      memberId: users.memberId,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, decoded.id))
    .limit(1);

  if (userRows.length === 0) {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 401 }
      ),
    };
  }

  const user = userRows[0];
  if (!user) {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 401 }
      ),
    };
  }

  if (user.status === 'suspended') {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: 'Account is suspended', code: 'ACCOUNT_SUSPENDED' },
        { status: 401 }
      ),
    };
  }

  if (user.status === 'inactive') {
    return {
      user: null,
      tenant: null,
      error: NextResponse.json(
        { success: false, message: 'Account is inactive', code: 'ACCOUNT_INACTIVE' },
        { status: 401 }
      ),
    };
  }

  // Fetch tenant info
  let tenant: TenantInfo | null = null;
  if (user.tenantId) {
    const tenantRows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        isMaintenanceMode: tenants.isMaintenanceMode,
      })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
      .limit(1);

    if (tenantRows.length > 0 && tenantRows[0]) {
      tenant = tenantRows[0];
      
      // Check tenant status
      if (tenant.status === 'suspended') {
        return {
          user: null,
          tenant: null,
          error: NextResponse.json(
            { success: false, message: 'Tenant is suspended', code: 'TENANT_SUSPENDED' },
            { status: 403 }
          ),
        };
      }
      
      if (tenant.isMaintenanceMode && !isSuperAdminRole(user.role)) {
        return {
          user: null,
          tenant: null,
          error: NextResponse.json(
            { success: false, message: 'Tenant is in maintenance mode', code: 'TENANT_MAINTENANCE' },
            { status: 503 }
          ),
        };
      }
    }
  }

  // Parse permissions
  const permissions: Record<string, string> =
    typeof user.permissions === 'object' && user.permissions !== null
      ? (user.permissions as Record<string, string>)
      : getDefaultPermissions(user.role || 'Member');

  const authedUser: AuthenticatedUser = {
    ...user,
    role: normalizeRole(user.role),
    status: user.status || 'active',
    permissions,
    lastLogin: user.lastLogin?.toString() || null,
    avatar: user.avatar || null,
    memberId: user.memberId || null,
    createdAt: user.createdAt?.toString() || '',
    updatedAt: user.updatedAt?.toString() || '',
  };
  // Fill the hot-path cache: next request with this token skips both SELECTs.
  authCache.set(hash, { user: authedUser, tenant, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return {
    user: authedUser,
    tenant,
  };
}

// Authenticated user type (role is the normalized canonical Role)
export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  lastLogin: string | null;
  avatar: string | null;
  memberId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  isMaintenanceMode: boolean;
}

// Authorization helpers
export function requireAuth(user: AuthenticatedUser | null): AuthenticatedUser {
  if (!user) {
    throw new AuthError('Authentication required');
  }
  return user;
}

export function requireAdmin(user: AuthenticatedUser | null): AuthenticatedUser {
  const userWithAuth = requireAuth(user);
  const role = normalizeRole(userWithAuth.role);
  if (role !== 'Admin' && role !== 'SuperAdmin') {
    throw new ForbiddenError('Admin access required');
  }
  return userWithAuth;
}

export function requireManagerOrAdmin(user: AuthenticatedUser | null): AuthenticatedUser {
  const userWithAuth = requireAuth(user);
  const role = normalizeRole(userWithAuth.role);
  if (role !== 'Admin' && role !== 'SuperAdmin' && role !== 'Manager') {
    throw new ForbiddenError('Admin or Manager access required');
  }
  return userWithAuth;
}

export function requireRole(...roles: Role[]) {
  return (user: AuthenticatedUser | null): AuthenticatedUser => {
    const userWithAuth = requireAuth(user);
    const role = normalizeRole(userWithAuth.role);
    if (!roles.includes(role)) {
      throw new ForbiddenError(`Requires one of: ${roles.join(', ')}`);
    }
    return userWithAuth;
  };
}

export function requirePermission(screen: string, level: PermissionLevel) {
  return (user: AuthenticatedUser | null): AuthenticatedUser => {
    const userWithAuth = requireAuth(user);
    if (!hasScreenPermission(userWithAuth, screen, level)) {
      throw new ForbiddenError(`${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screen}`);
    }
    return userWithAuth;
  };
}

export function requireAnyPermission(screens: string[], level: PermissionLevel) {
  return (user: AuthenticatedUser | null): AuthenticatedUser => {
    const userWithAuth = requireAuth(user);
    if (!hasAnyScreenPermission(userWithAuth, screens, level)) {
      throw new ForbiddenError(`${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screens.join(' or ')}`);
    }
    return userWithAuth;
  };
}

// Deposit write permission check
export function requireDepositWritePermission(user: AuthenticatedUser, status: string): AuthenticatedUser {
  const isPendingRequest = status.toLowerCase() === 'pending';
  if (isPendingRequest) {
    if (!hasAnyScreenPermission(user, ['REQUEST_DEPOSIT', 'DEPOSITS'], 'WRITE')) {
      throw new ForbiddenError('Write permission required for: REQUEST_DEPOSIT or DEPOSITS');
    }
  } else {
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }
  }
  return user;
}

// SuperAdmin check (SuperAdmin role or platform-owner allowlist)
export function requireSuperAdmin(user: AuthenticatedUser | null): AuthenticatedUser {
  const userWithAuth = requireAuth(user);
  if (!isSuperAdminRole(userWithAuth.role) && !isPlatformOwnerEmail(userWithAuth.email)) {
    throw new ForbiddenError('SuperAdmin access required');
  }
  return userWithAuth;
}

export async function getAuthContext(request: NextRequest): Promise<{
  user: AuthenticatedUser | null;
  tenantId: string | null;
  error?: NextResponse;
}> {
  const userId = request.headers.get('x-user-id');
  if (userId) {
    const role = normalizeRole(request.headers.get('x-user-role') || 'Member');
    const tenantId = request.headers.get('x-tenant-id');
    const email = request.headers.get('x-user-email') || '';
    const permissionsHeader = request.headers.get('x-user-permissions');
    let permissions: Record<string, string> = {};
    if (permissionsHeader) {
      try {
        permissions = JSON.parse(permissionsHeader);
      } catch {}
    }
    return {
      user: {
        id: userId,
        tenantId,
        name: request.headers.get('x-user-name') || '',
        email,
        role,
        status: 'active',
        permissions,
        lastLogin: null,
        avatar: null,
        memberId: request.headers.get('x-user-member-id') || null,
        createdAt: '',
        updatedAt: '',
      },
      tenantId,
    };
  }

  const { user, tenant, error } = await authenticateRequest(request);
  if (error) {
    return { user: null, tenantId: null, error };
  }
  const resolvedTenantId = user?.tenantId || tenant?.id || null;
  // Subscription gate: platform operators (null tenant) are never blocked.
  if (resolvedTenantId && (await getTenantSubscriptionBlocked(resolvedTenantId))) {
    return {
      user: null,
      tenantId: null,
      error: NextResponse.json(
        { success: false, message: 'Subscription is inactive. Please contact support.', code: 'SUBSCRIPTION_BLOCKED' },
        { status: 403 },
      ),
    };
  }
  return {
    user,
    tenantId: resolvedTenantId,
  };
}

// Export all needed types and functions
export { COOKIE_NAMES, hasScreenPermission, hasAnyScreenPermission };