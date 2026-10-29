import { NextResponse } from 'next/server';
import { bucketKey, consumeBucket, type BucketOutcome } from '@/lib/rate-limit';
import { getAbuseClientIp } from '@/lib/request-meta';
import type { NextRequest } from 'next/server';

/**
 * Shared abuse control for authenticated and expensive endpoints.
 *
 * The primitive in lib/rate-limit.ts is sound (Postgres-backed so it survives
 * serverless cold starts, atomic INSERT..ON CONFLICT so a parallel burst cannot
 * all read the same count, and it throws rather than failing open). What it
 * lacked was a way to be *used*: it was wired into 7 of 106 routes because every
 * caller had to re-implement key derivation, fail-closed handling and the 429
 * envelope by hand. This module makes adding a limit a one-line, non-skippable
 * call.
 *
 * Usage inside a route handler, after the session guard and before any work:
 *
 *   const limited = await guard(request, 'expensive', { user: user.id, tenant: tenantId });
 *   if (limited) return limited;
 *
 * It returns a response to send or null to proceed, so it never has to agree
 * with the handler's own error envelope, and cannot be silently swallowed by a
 * `catch` that drops the Retry-After header.
 */

export type GuardScope = 'auth' | 'public' | 'expensive' | 'export' | 'recompute';

interface Dimension {
  limit: number;
  windowSecs: number;
}

interface Profile {
  ip?: Dimension;
  user?: Dimension;
  tenant?: Dimension;
}

/**
 * Named profiles. Windows are fixed (see consumeBucket), so a burst is tolerated
 * at the boundary; the numbers below bound *cost*, not fairness, so they are set
 * generously above real usage — a limit that fires in normal use gets commented
 * out, and then it protects nothing.
 *
 * `expensive` = per-request fan-out over the tenant's ledger (analytics, report
 * planning). `recompute` = mutating full-tenant recalculations, deliberately the
 * tightest: one Admin pressing F5 on recalculate-all pins a function for 300s.
 */
const PROFILES: Record<GuardScope, Profile> = {
  // Pre-session paths. IP alone is available; `unknown` gets its own wider
  // ceiling in the caller so a deployment without the platform header still
  // gets a bound rather than an open door.
  auth: { ip: { limit: 30, windowSecs: 60 }, user: { limit: 20, windowSecs: 60 } },
  public: { ip: { limit: 120, windowSecs: 60 } },
  expensive: { user: { limit: 30, windowSecs: 300 }, tenant: { limit: 120, windowSecs: 300 } },
  export: { user: { limit: 20, windowSecs: 3600 }, tenant: { limit: 60, windowSecs: 3600 } },
  recompute: { user: { limit: 4, windowSecs: 3600 }, tenant: { limit: 12, windowSecs: 3600 } },
};

export interface GuardIds {
  /** Session user id. Required for the user dimension; skipped if absent. */
  user?: string | null;
  /** Tenant id from the SESSION (never from the request). */
  tenant?: string | null;
  /** Extra discriminator so one shared helper can serve several distinct routes
   *  without them sharing a bucket (e.g. the two cron jobs). */
  suffix?: string;
}

function denied(outcome: BucketOutcome, scope: GuardScope): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message: 'Too many requests. Please try again shortly.',
      code: 'RATE_LIMITED',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(outcome.retryAfterSec),
        'X-RateLimit-Limit': String(outcome.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Scope': scope,
      },
    },
  );
}

function unavailable(scope: GuardScope): NextResponse {
  // The counter store is the control. If it cannot be read, admitting the
  // request would mean the control silently disappears under exactly the load
  // it exists for — so deny, per lib/rate-limit.ts.
  return NextResponse.json(
    { success: false, message: 'Too many requests right now. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' },
    { status: 503, headers: { 'X-RateLimit-Scope': scope } },
  );
}

/**
 * Spend one request from every applicable dimension of the profile.
 *
 * All dimensions are consumed even when an earlier one already denies: a partial
 * spend would let a client probe which dimension it tripped. Order of denial
 * reporting is the most restrictive dimension (largest retry window).
 *
 * Fails CLOSED: an unreachable counter table returns 503, never a pass.
 */
export async function guard(
  request: NextRequest,
  scope: GuardScope,
  ids: GuardIds = {},
): Promise<NextResponse | null> {
  const profile = PROFILES[scope];
  const suffix = ids.suffix ? `:${ids.suffix}` : '';
  const outcomes: BucketOutcome[] = [];

  try {
    const jobs: Array<Promise<BucketOutcome> | null> = [
      profile.ip
        ? consumeBucket(
            bucketKey(`g:${scope}:ip${suffix}`, getAbuseClientIp(request)),
            getAbuseClientIp(request) === 'unknown' ? profile.ip.limit * 4 : profile.ip.limit,
            profile.ip.windowSecs,
          )
        : null,
      profile.user && ids.user
        ? consumeBucket(bucketKey(`g:${scope}:user${suffix}`, ids.user), profile.user.limit, profile.user.windowSecs)
        : null,
      profile.tenant && ids.tenant
        ? consumeBucket(bucketKey(`g:${scope}:tenant${suffix}`, ids.tenant), profile.tenant.limit, profile.tenant.windowSecs)
        : null,
    ];
    outcomes.push(...((await Promise.all(jobs)).filter(Boolean) as BucketOutcome[]));
  } catch {
    return unavailable(scope);
  }

  const tripped = outcomes.filter((o) => !o.ok).sort((a, b) => b.retryAfterSec - a.retryAfterSec)[0];
  return tripped ? denied(tripped, scope) : null;
}
