import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { eq, and, gt, isNull, ne, or } from 'drizzle-orm';
import { getDb } from './db';
import { users, sessions, blacklistedTokens } from '../db/schema/index';
import { verifyToken, COOKIE_NAMES } from './jwt';
import { normalizeRole } from '../shared/roles';
import {
  SESSION_ACTIVITY_TOUCH_THROTTLE_MS,
  SUPPORT_SESSION_LIFETIME_MS,
  isAbsoluteSessionExpired,
  isSessionIdle,
} from '@/lib/session-limits';

/**
 * Session/user cache — identical resolution logic to the Express `protect`
 * middleware: HttpOnly access cookie -> JWT verify -> user record lookup
 * (60s in-process cache). Account-status, tenant and entitlement gates are
 * enforced by requireSession (server/src/middleware/api.ts), which is this
 * function's only caller.
 */
interface CachedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  memberId: string | null;
  tenantId: string | null;
}

const USER_CACHE_TTL = 60_000;
// Keyed by sha256(token) (never the raw token): distinct credentials never
// share a cached identity. Active-session and blacklist state are rechecked
// against PostgreSQL before this cache is consulted.
const userCache = new Map<string, { user: CachedUser; expires: number }>();

let cacheLastSweep = 0;
function sweepCache() {
  const now = Date.now();
  if (now - cacheLastSweep < 5 * 60_000) return;
  cacheLastSweep = now;
  for (const [k, v] of userCache) if (v.expires < now) userCache.delete(k);
}

/** Cache key: userId + token hash — never stores or logs the raw token. */
function cacheKey(token: string): string {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `${hash.slice(0, 24)}`;
}

/** sha256 hex of a token — rows store the hash, never the raw JWT. */
function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function getSessionUser(): Promise<CachedUser | null> {
  sweepCache();
  const token = (await cookies()).get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!token) return null;

  let decoded: { id: string; sessionId?: string };
  try {
    decoded = verifyToken(token, 'access');
  } catch {
    return null;
  }

  if (!decoded.sessionId) return null;

  const db = getDb();

  // Check both per-token revocation and active-session status before consulting
  // the cached identity. This keeps logout-all and single-session revocation
  // immediate across instances and prevents the user cache bypassing revocation.
  // Rows store sha256(token) hex — hash before matching, or rotated/logged-out
  // tokens stay valid here until their 15m JWT expiry (was: raw comparison).
  const [sessionState] = await db
    .select({
      blacklistId: blacklistedTokens.id,
      loginTime: sessions.loginTime,
      lastActivity: sessions.lastActivity,
    })
    .from(sessions)
    .leftJoin(
      blacklistedTokens,
      and(eq(blacklistedTokens.token, tokenHash(token)), gt(blacklistedTokens.expiresAt, new Date())),
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
          gt(sessions.loginTime, new Date(Date.now() - SUPPORT_SESSION_LIFETIME_MS)),
        ),
      ),
    )
    .limit(1);
  if (!sessionState || sessionState.blacklistId) return null;
  // Same lifetime bounds as the modern gate (lib/middleware/auth.ts):
  // absolute 24h cap + server-side idle kill. Without these, the money API
  // would accept sessions the main stack already considers dead.
  const now = Date.now();
  if (isAbsoluteSessionExpired(sessionState.loginTime, now)) return null;
  if (isSessionIdle(sessionState.lastActivity, now)) return null;
  if (sessionState.lastActivity) {
    const lastTouch = new Date(sessionState.lastActivity).getTime();
    if (!Number.isNaN(lastTouch) && now - lastTouch > SESSION_ACTIVITY_TOUCH_THROTTLE_MS) {
      try {
        await db
          .update(sessions)
          .set({ lastActivity: new Date(now), updatedAt: new Date(now) })
          .where(and(eq(sessions.sessionId, decoded.sessionId), eq(sessions.userId, decoded.id)));
      } catch {
        // Activity tracking must never fail authentication.
      }
    }
  }

  const cached = userCache.get(cacheKey(token));
  if (cached && cached.expires > Date.now()) return cached.user;

  const userId = decoded.id;
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      permissions: users.permissions,
      memberId: users.memberId,
      tenantId: users.tenantId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;
  // Account status (suspended/inactive) is deliberately NOT collapsed to null
  // here: requireSession (server/src/middleware/api.ts) enforces it per request
  // with the modern stack's exact codes (401 ACCOUNT_SUSPENDED /
  // ACCOUNT_INACTIVE, mirroring lib/middleware/auth.ts) instead of a generic
  // "Authentication required". The status rides on the cached identity, so the
  // gate is evaluated on every call.

  const resolved: CachedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeRole(user.role),
    status: user.status || 'active',
    permissions:
      typeof user.permissions === 'object' && user.permissions !== null
        ? (user.permissions as Record<string, string>)
        : {},
    memberId: user.memberId || null,
    tenantId: user.tenantId ?? null,
  };

  userCache.set(cacheKey(token), { user: resolved, expires: Date.now() + USER_CACHE_TTL });
  return resolved;
}
