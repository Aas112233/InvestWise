import { getDb } from '@/db/index';
import { tenantSubscriptions } from '@/db/schema/index';
import { eq } from 'drizzle-orm';

// Central subscription gate (Pathshala-Pro port, trimmed: no payment provider).
// A tenant is blocked when its subscription is suspended/cancelled/expired, or
// past-due beyond grace. Platform operators (null tenant) are never blocked.

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | 'expired';

const HARD_BLOCKED: ReadonlySet<string> = new Set(['suspended', 'cancelled', 'expired']);

// 60s per-tenant cache: the subscription check ran 1 SELECT per API request.
// Staleness is bounded well below the edge JWT claim carrying the same signal
// (15m access-token lifetime), so this is strictly fresher than edge fencing.
// ponytail: add explicit invalidation here if billing webhooks ever need
// instant (<60s) enforcement.
const SUB_CACHE_TTL_MS = 60_000;
const subCache = new Map<string, { blocked: boolean; expiresAt: number }>();
let subLastSweep = 0;

export function isSubscriptionBlocked(
  status: string | null | undefined,
  graceEndsAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!status) return false;
  if (HARD_BLOCKED.has(status)) return true;
  if (status === 'past_due') {
    if (!graceEndsAt) return true;
    return new Date(graceEndsAt).getTime() <= now.getTime();
  }
  return false;
}

export async function getTenantSubscriptionBlocked(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const now = Date.now();
  const cached = subCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.blocked;
  if (now - subLastSweep > 60_000) {
    subLastSweep = now;
    for (const [id, entry] of subCache) {
      if (entry.expiresAt < now) subCache.delete(id);
    }
  }
  const db = getDb();
  const [sub] = await db
    .select({ status: tenantSubscriptions.status, graceEndsAt: tenantSubscriptions.graceEndsAt })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  const blocked = !sub ? false : isSubscriptionBlocked(sub.status, sub.graceEndsAt);
  subCache.set(tenantId, { blocked, expiresAt: now + SUB_CACHE_TTL_MS });
  return blocked;
}
