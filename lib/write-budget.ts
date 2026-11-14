import { NextRequest, NextResponse } from 'next/server';
import { consumeBucket, bucketKey, type BucketOutcome } from '@/lib/rate-limit';
import { isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';

/**
 * Global write budget (audit 2026-11, "attack phase" follow-up item 1).
 *
 * Per-route budgets cover the heavy desks (bulk deposits, login, exports), but
 * every OTHER authenticated write was unbounded: a stolen low-privilege session
 * could hammer any POST/PUT/DELETE at wire speed, churning ledger rows, audit
 * rows and function invocations until the platform or the wallet of the
 * deployment bill breaks. This budget is the FLOOR under every write on both
 * auth stacks — deliberately far above any legitimate officer's cadence
 * (typical desk work is well under 100 writes/hour), and never a substitute
 * for the per-route ceilings that stack on top of it.
 *
 *   user   240 writes / 5 min  — one stolen session cannot outrun cleanup
 *   tenant 2400 writes / 5 min — a tenant's whole staff cannot multiply past it
 *
 * Design notes:
 *  - Counters are the shared Postgres fixed-window buckets (lib/rate-limit.ts),
 *    so the ceiling holds under concurrency and across serverless instances.
 *  - A counter failure DENIES (503), matching enforceRateLimit in the finance
 *    handlers — a throttle that fails open is a log, not a control.
 *  - Platform operators (SuperAdmin / platform-owner email) are exempt, the
 *    same bypass every other tenant gate grants them for support work; a
 *    SuperAdmin account is already game-over, and throttling support's bulk
 *    operations would break incident response, not an attack.
 *  - Exempt paths: /api/auth (has its own lockout + throttle controls),
 *    /api/cron (secret-gated machine traffic), /api/health (public probe).
 *  - GET/HEAD/OPTIONS never consume — the budget is a WRITE budget.
 */

export const WRITE_BUDGET = {
  scope: 'global-write',
  /** Per user, per window. */
  userLimit: 240,
  /** Per tenant, per window. */
  tenantLimit: 2400,
  windowSecs: 300,
} as const;

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const EXEMPT_PREFIXES = ['/api/auth/', '/api/cron/', '/api/health'];

/** Pure predicate — unit-tested without a database. */
export function shouldApplyWriteBudget(method: string, pathname: string | null): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  if (!pathname) return false;
  for (const prefix of EXEMPT_PREFIXES) {
    if (pathname.startsWith(prefix)) return false;
  }
  return true;
}

export interface BudgetUser {
  id: string;
  tenantId: string | null;
  email: string;
  role: string;
}

function isPlatformOperator(user: BudgetUser): boolean {
  return isSuperAdminRole(user.role) || isPlatformOwnerEmail(user.email);
}

export interface WriteBudgetOutcome {
  ok: boolean;
  /** Seconds until the tightest exhausted window rolls over; 0 when admitted. */
  retryAfterSec: number;
}

/**
 * Spend one write from both the per-user and per-tenant budgets. Fails CLOSED
 * (throws) when the counters are unreachable — callers turn the throw into a
 * 503, not an admission. Platform operators are admitted without consuming.
 */
export async function consumeWriteBudget(user: BudgetUser): Promise<WriteBudgetOutcome> {
  if (isPlatformOperator(user)) return { ok: true, retryAfterSec: 0 };
  const tenantId = user.tenantId;
  // Fail closed for a null-tenant identity on a write: the per-route guards
  // reject it anyway, but do not let a misconfigured account consume nothing.
  if (!tenantId) return { ok: false, retryAfterSec: WRITE_BUDGET.windowSecs };

  let buckets: [BucketOutcome, BucketOutcome];
  try {
    buckets = await Promise.all([
      consumeBucket(
        bucketKey(`${WRITE_BUDGET.scope}:user`, `${tenantId}:${user.id}`),
        WRITE_BUDGET.userLimit,
        WRITE_BUDGET.windowSecs,
      ),
      consumeBucket(
        bucketKey(`${WRITE_BUDGET.scope}:tenant`, tenantId),
        WRITE_BUDGET.tenantLimit,
        WRITE_BUDGET.windowSecs,
      ),
    ]);
  } catch {
    // Deny loudly — surfaced by the caller as 503 RATE_LIMIT_UNAVAILABLE.
    throw new Error('write budget counter unavailable');
  }

  const blocked = buckets.filter((b) => !b.ok);
  if (blocked.length > 0) {
    return { ok: false, retryAfterSec: Math.max(...blocked.map((b) => b.retryAfterSec)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Modern-stack wire point: returns the 429/503 response to send instead of the
 * handler, or null when the write is admitted. Call it AFTER the identity is
 * resolved and BEFORE any handler work — including on the identity-cache hit
 * path, since the budget is per-request, not per-identity-fetch.
 */
export async function writeBudgetResponseOrNull(
  request: NextRequest,
  user: BudgetUser,
): Promise<NextResponse | null> {
  if (!shouldApplyWriteBudget(request.method, request.nextUrl.pathname)) return null;
  try {
    const outcome = await consumeWriteBudget(user);
    if (outcome.ok) return null;
    return NextResponse.json(
      {
        success: false,
        message: 'Too many write requests. Please slow down and try again shortly.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } },
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: 'Request throttling is temporarily unavailable. Please try again shortly.',
        code: 'RATE_LIMIT_UNAVAILABLE',
      },
      { status: 503 },
    );
  }
}
