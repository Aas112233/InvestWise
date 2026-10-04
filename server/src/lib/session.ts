import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from './db.js';
import { users, blacklistedTokens } from '../db/schema/index.js';
import { verifyToken, COOKIE_NAMES } from './jwt.js';
import { normalizeRole } from '../shared/roles.js';

/**
 * Session/user cache — identical resolution logic to the Express `protect`
 * middleware: HttpOnly access cookie -> JWT verify -> user record lookup
 * (60s in-process cache) -> status checks.
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
// Keyed by sha256(token) (never the raw token): a rotated/logged-out token
// gets its own entry and its own blacklist check — it never reuses another
// token's cached identity.
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

export async function getSessionUser(): Promise<CachedUser | null> {
  sweepCache();
  const token = (await cookies()).get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  if (!token) return null;

  let userId: string;
  try {
    userId = verifyToken(token, 'access').id;
  } catch {
    return null;
  }

  const cached = userCache.get(cacheKey(token));
  if (cached && cached.expires > Date.now()) return cached.user;

  const db = getDb();

  // Blacklist check (parity with lib/middleware/auth.ts): a revoked access
  // token — logout, logout-all, rotation — must not keep authenticating the
  // server-module routes (funds transfer, finance handlers) until its 15m
  // expiry. Checked on cache miss only: ≤1 extra DB read per 60s per token.
  const [revoked] = await db
    .select({ id: blacklistedTokens.id })
    .from(blacklistedTokens)
    .where(and(eq(blacklistedTokens.token, token), gt(blacklistedTokens.expiresAt, new Date())))
    .limit(1);
  if (revoked) return null;

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
  if (user.status === 'suspended' || user.status === 'inactive') return null;

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
