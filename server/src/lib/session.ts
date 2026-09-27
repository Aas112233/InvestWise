import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { users } from '../db/schema/index.js';
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
const userCache = new Map<string, { user: CachedUser; expires: number }>();

let cacheLastSweep = 0;
function sweepCache() {
  const now = Date.now();
  if (now - cacheLastSweep < 5 * 60_000) return;
  cacheLastSweep = now;
  for (const [k, v] of userCache) if (v.expires < now) userCache.delete(k);
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

  const cached = userCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.user;

  const db = getDb();
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

  userCache.set(userId, { user: resolved, expires: Date.now() + USER_CACHE_TTL });
  return resolved;
}
