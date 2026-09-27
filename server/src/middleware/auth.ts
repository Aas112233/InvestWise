import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../config/database.js';
import { users, blacklistedTokens } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { verifyToken } from '../lib/jwt.js';
import { COOKIE_NAMES } from '../lib/cookies.js';
import { AuthError, ForbiddenError } from '../shared/errors.js';
import { asyncHandler } from '../shared/asyncHandler.js';
import { cache } from '../lib/cache.js';
import { normalizeRole, roleBaselineGrant, type Role } from '../shared/roles.js';

// Cache parsed user records by userId for 60 seconds to avoid a DB round-trip
// on every authenticated request. JWT verification (fast crypto) still runs.
const USER_CACHE_TTL = 60_000;

/**
 * In-memory blacklist cache.
 * Stores SHA-256 hashes (not raw tokens) of revoked tokens with their expiry.
 * Avoids a Supabase round-trip (~300 ms) on every authenticated request.
 * On logout, the token is added here immediately via `blacklistToken()`.
 */
const blacklistCache = new Map<string, number>(); // hash → expiresAt ms
let blacklistLastSweep = 0;

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Add a token to the in-memory blacklist (call on logout). */
export function blacklistToken(token: string, expiresAt: Date): void {
  blacklistCache.set(tokenHash(token), expiresAt.getTime());
}

/**
 * Returns true if the token is blacklisted.
 * Checks the in-memory cache first; falls back to DB only on a miss
 * (which only happens for tokens revoked by another server instance).
 */
async function isBlacklisted(token: string): Promise<boolean> {
  const hash = tokenHash(token);
  const now = Date.now();

  // Periodic sweep: evict expired entries every 5 minutes
  if (now - blacklistLastSweep > 5 * 60_000) {
    blacklistLastSweep = now;
    for (const [h, exp] of blacklistCache) {
      if (exp < now) blacklistCache.delete(h);
    }
  }

  // Cache hit — token is known to be blacklisted and not yet expired
  const cachedExp = blacklistCache.get(hash);
  if (cachedExp !== undefined) {
    return cachedExp > now; // still valid blacklist entry
  }

  // Cache miss — check DB (handles tokens revoked by another server process)
  const db = getDb();
  const rows = await db
    .select({ id: blacklistedTokens.id, expiresAt: blacklistedTokens.expiresAt })
    .from(blacklistedTokens)
    .where(and(eq(blacklistedTokens.token, token), gt(blacklistedTokens.expiresAt, new Date())))
    .limit(1);

  if (rows.length > 0) {
    // Populate cache so future requests skip the DB
    blacklistCache.set(hash, rows[0].expiresAt!.getTime());
    return true;
  }

  // Token is clean — record a negative entry (not blacklisted) with a short TTL
  // so we don't hammer the DB repeatedly for the same active token.
  blacklistCache.set(hash, now - 1); // immediately-expired = "clean"
  return false;
}

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

  // Check blacklist (in-memory first, DB fallback)
  if (await isBlacklisted(token)) {
    throw new AuthError('Token has been revoked', 'TOKEN_REVOKED');
  }

  // Verify JWT
  const decoded = verifyToken(token, 'access');

  // Fetch user — check cache first (avoids a DB round-trip per request)
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

