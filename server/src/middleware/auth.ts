import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../config/database';
import { users, sessions, blacklistedTokens } from '../db/schema/index';
import { eq, and, gt, isNull, ne, or } from 'drizzle-orm';
import { verifyToken } from '../lib/jwt';
import { COOKIE_NAMES } from '../lib/cookies';
import { AuthError, ForbiddenError } from '../shared/errors';
import { asyncHandler } from '../shared/asyncHandler';
import { cache } from '../lib/cache';
import { normalizeRole, roleBaselineGrant, type Role } from '../shared/roles';

// Cache parsed user records by userId for 60 seconds. Session and blacklist
// state are still read from PostgreSQL on every authenticated request.
const USER_CACHE_TTL = 60_000;

/**
 * Unified role taxonomy (RBAC): SuperAdmin, Admin, Manager, Auditor, Member.
 * Legacy role strings normalize via lib/roles.ts — numeric access levels
 * were removed. Mirrors lib/roles.ts 1:1.
 */
type PermissionLevel = 'READ' | 'WRITE';

/**
 * Authenticate user via HttpOnly cookie or Bearer JWT token.
 * Sets req.user with full user record directly from the database.
 */
export const protect = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  // 1. Prioritize secure HttpOnly cookie, fall back to Authorization header
  let token: string | undefined = req.cookies?.[COOKIE_NAMES.ACCESS_TOKEN];
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    throw new AuthError('No token provided', 'NO_TOKEN');
  }

  // Verify the signature before database access, then require an active,
  // persisted session. The joined blacklist lookup and session-state check are
  // performed on every request so revocations propagate across instances.
  const decoded = verifyToken(token, 'access');
  if (!decoded.sessionId) {
    throw new AuthError('Session is not active', 'TOKEN_REVOKED');
  }
  const db = getDb();
  const [sessionState] = await db
    .select({ blacklistId: blacklistedTokens.id })
    .from(sessions)
    .leftJoin(
      blacklistedTokens,
      and(eq(blacklistedTokens.token, token), gt(blacklistedTokens.expiresAt, new Date())),
    )
    .where(
      and(
        eq(sessions.sessionId, decoded.sessionId),
        eq(sessions.userId, decoded.id),
        eq(sessions.isActive, true),
        eq(sessions.isExpired, false),
        or(
          isNull(sessions.deviceInfo),
          ne(sessions.deviceInfo, 'Support'),
          gt(sessions.loginTime, new Date(Date.now() - 30 * 60_000)),
        ),
      ),
    )
    .limit(1);
  if (!sessionState || sessionState.blacklistId) {
    throw new AuthError('Token or session has been revoked', 'TOKEN_REVOKED');
  }

  // Fetch user — check cache first (avoids a user-row round-trip per request).
  // Session revocation above is intentionally not cached.
  const cacheKey = `auth:user:${decoded.id}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let user = cache.get<any>(cacheKey);

  if (!user) {
    const db = getDb();
    user = await db
      .select({
        id: users.id,
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
      .limit(1)
      .then((rows: Array<Record<string, unknown>>) => rows[0]);

    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    // Cache the raw DB row for future requests
    cache.set(cacheKey, user, USER_CACHE_TTL);
  }

  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED');
  }

  if (user.status === 'inactive') {
    throw new AuthError('Account is inactive', 'ACCOUNT_INACTIVE');
  }

  // Parse permissions from JSONB
  const permissions: Record<string, string> =
    typeof user.permissions === 'object' && user.permissions !== null
      ? (user.permissions as Record<string, string>)
      : {};

  req.user = {
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

  // RLS context (set_config) skipped — Supabase transaction-mode pooler
  // (port 6543) randomizes connections per statement, making session-level
  // settings ineffective. Re-enable when switching to session-mode (port 5432).

  next();
});

/**
 * Require Admin role (platform SuperAdmins pass everywhere).
 */
export function admin(req: Request, _res: Response, next: NextFunction): void {
  const role = normalizeRole(req.user?.role || '');
  if (role !== 'Admin' && role !== 'SuperAdmin') {
    throw new ForbiddenError('Admin access required');
  }
  next();
}

/**
 * Require Admin or Manager role.
 */
export function managerOrAdmin(req: Request, _res: Response, next: NextFunction): void {
  const role = normalizeRole(req.user?.role || '');
  if (role !== 'Admin' && role !== 'SuperAdmin' && role !== 'Manager') {
    throw new ForbiddenError('Admin or Manager access required');
  }
  next();
}

/**
 * Require specific role(s).
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = normalizeRole(req.user?.role || '');
    if (!req.user || !roles.includes(role)) {
      throw new ForbiddenError(`Requires one of: ${roles.join(', ')}`);
    }
    next();
  };
}

/**
 * Evaluate whether a user has the required permission for a screen.
 * Role-based (mirrors lib/permissions.ts 1:1): normalized role baseline plus
 * explicit JSONB overrides; SuperAdmin/Admin bypass overrides.
 */
export function hasScreenPermission(
  user: { role?: string; permissions?: Record<string, string> } | null | undefined,
  screen: string,
  requiredLevel: PermissionLevel = 'WRITE',
): boolean {
  if (!user) return false;

  const role = normalizeRole(user.role);

  // SuperAdmin/Admin have unconditional WRITE & READ everywhere
  if (role === 'SuperAdmin' || role === 'Admin') {
    return true;
  }

  // Explicit user permission takes highest precedence
  const explicit = user.permissions?.[screen];
  if (explicit === 'WRITE') return true;
  if (explicit === 'READ' && requiredLevel === 'READ') return true;
  if (explicit === 'NONE') return false;

  // Parent fallback only when no explicit override
  if (!explicit) {
    if (screen === 'MEETINGS' || screen === 'GOVERNANCE') {
      const parent = user.permissions?.['MEMBERS'];
      if (parent === 'WRITE') return true;
      if (parent === 'READ' && requiredLevel === 'READ') return true;
      if (parent === 'NONE') return false;
    } else if (screen === 'TRANSACTIONS') {
      const parent = user.permissions?.['DEPOSITS'];
      if (parent === 'WRITE') return true;
      if (parent === 'READ' && requiredLevel === 'READ') return true;
      if (parent === 'NONE') return false;
    }
  }

  // Role baseline (Manager: write except SETTINGS; Auditor: read-only;
  // Member: level-2 read set + REQUEST_DEPOSIT write)
  const baseline = roleBaselineGrant(role, screen);
  if (baseline === 'WRITE') return true;
  if (baseline === 'READ') return requiredLevel === 'READ';

  return false;
}

/**
 * Check if user has permission for at least one of the listed screens.
 */
export function hasAnyScreenPermission(
  user: { role?: string; permissions?: Record<string, string> } | null | undefined,
  screens: string[],
  requiredLevel: PermissionLevel = 'WRITE',
): boolean {
  return screens.some((s) => hasScreenPermission(user, s, requiredLevel));
}

/**
 * Require screen-level permission with role inheritance and explicit override resolution.
 */
export function requirePermission(screen: string, level: PermissionLevel) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthError('Authentication required');
    }

    if (!hasScreenPermission(req.user, screen, level)) {
      throw new ForbiddenError(`${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screen}`);
    }

    next();
  };
}

/**
 * Require at least one of the specified screen permissions.
 */
export function requireAnyPermission(screens: string[], level: PermissionLevel) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthError('Authentication required');
    }

    if (!hasAnyScreenPermission(req.user, screens, level)) {
      throw new ForbiddenError(`${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screens.join(' or ')}`);
    }

    next();
  };
}

/**
 * Middleware for POST /api/finance/deposits:
 * - If status === 'Pending' (or pending request), user needs either REQUEST_DEPOSIT (WRITE) or DEPOSITS (WRITE).
 * - If status !== 'Pending', user strictly needs DEPOSITS (WRITE).
 */
export function requireDepositWritePermission(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AuthError('Authentication required');
  }

  const status = String(req.body?.status || '').toLowerCase();
  const isPendingRequest = status === 'pending' || req.originalUrl.includes('request');
  if (isPendingRequest) {
    if (!hasAnyScreenPermission(req.user, ['REQUEST_DEPOSIT', 'DEPOSITS'], 'WRITE')) {
      throw new ForbiddenError('Write permission required for: REQUEST_DEPOSIT or DEPOSITS');
    }
  } else {
    if (!hasScreenPermission(req.user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }
  }

  next();
}

