import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, withDbRetry } from '@/db/index';
import { rateLimitBuckets } from '@/db/schema/index';

/**
 * Shared, race-free abuse counters for unauthenticated endpoints.
 *
 * Deliberately Postgres-backed rather than in-memory: this app is deployed to a
 * serverless runtime, where a process-local map resets on every cold start and
 * multiplies its own ceiling by the number of live instances.
 */

export interface BucketOutcome {
  ok: boolean;
  /** Requests counted for this key inside the current window, this one included. */
  count: number;
  limit: number;
  windowSecs: number;
  /** Seconds until the window rolls over; 0 when admitted. */
  retryAfterSec: number;
}

/**
 * Keys include client-controlled data, so IPs are hashed: the table stays
 * disposable telemetry instead of becoming a second IP log next to
 * login_attempts, and the key can never break out of its own quoting.
 */
export function bucketKey(scope: string, identity: string): string {
  const digest = createHash('sha256').update(identity.toLowerCase()).digest('hex').slice(0, 32);
  return `${scope}:${digest}`;
}

/**
 * Atomically spends one request from a fixed window.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is serialized per
 * key by Postgres, so a parallel burst cannot all read the same count and all
 * be admitted — the failure mode this replaces.
 *
 * Throws when the counter cannot be read or written. Callers must treat that as
 * "deny": a throttle that fails open is not a control, it is a log.
 */
export async function consumeBucket(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<BucketOutcome> {
  if (!Number.isFinite(limit) || limit < 1) throw new Error('consumeBucket: limit must be >= 1');
  if (!Number.isFinite(windowSecs) || windowSecs < 1) throw new Error('consumeBucket: windowSecs must be >= 1');

  const db = getDb();
  const expired = sql`now() - (${Math.trunc(windowSecs)}::int * interval '1 second')`;

  const [row] = await withDbRetry(() =>
    db
      .insert(rateLimitBuckets)
      .values({ bucketKey: key, windowStartedAt: new Date(), count: 1 })
      .onConflictDoUpdate({
        target: rateLimitBuckets.bucketKey,
        set: {
          count: sql`CASE WHEN ${rateLimitBuckets.windowStartedAt} <= ${expired} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${rateLimitBuckets.windowStartedAt} <= ${expired} THEN now() ELSE ${rateLimitBuckets.windowStartedAt} END`,
          updatedAt: new Date(),
        },
      })
      .returning({ count: rateLimitBuckets.count, windowStartedAt: rateLimitBuckets.windowStartedAt }),
  );

  const count = Number(row?.count ?? 1);
  const windowStart = row?.windowStartedAt ? new Date(row.windowStartedAt).getTime() : Date.now();
  const ok = count <= limit;

  return {
    ok,
    count,
    limit,
    windowSecs,
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((windowStart + windowSecs * 1000 - Date.now()) / 1000)),
  };
}

/**
 * Deletes counters older than two days. Called from the daily cron: the key
 * space is one row per client IP, so it has to be swept or the abuse control
 * itself becomes the storage problem.
 */
export async function pruneRateLimitBuckets(): Promise<number> {
  const db = getDb();
  const deleted = await withDbRetry(() =>
    db
      .delete(rateLimitBuckets)
      .where(sql`${rateLimitBuckets.updatedAt} < now() - (${2 * 24 * 3600}::int * interval '1 second')`)
      .returning({ bucketKey: rateLimitBuckets.bucketKey }),
  );
  return deleted.length;
}
