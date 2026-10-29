import { sql } from 'drizzle-orm';
import { getDb, withDbRetry } from '@/db/index';
import { accountLocks } from '@/db/schema/index';

/**
 * Account lockout control state (Postgres-backed, one row per normalized email).
 *
 * Why this is not derived from `login_attempts`
 * --------------------------------------------
 * The previous implementation counted failed rows in the forensic log inside a
 * rolling window. Because the "you are locked" rejection also inserted a
 * `success = false` row and the count did not filter on `failure_reason`, every
 * attempt made while locked pushed the unlock time out by another full window —
 * so the advice in the error message ("try again later") extended the lockout it
 * was describing. A successful sign-in never cleared the failures either, and
 * count-then-insert is not atomic, so a parallel burst could all read the same
 * pre-threshold count and all be admitted.
 *
 * Why Postgres and not memory
 * ---------------------------
 * Serverless. A process-local map resets on every cold start and multiplies its
 * own ceiling by the number of live instances, which for a five-strike lockout
 * means an attacker gets five attempts per warm instance.
 *
 * `login_attempts` is unchanged and goes back to being only the forensic log.
 */

/** Failures tolerated before the address is locked. */
export const LOCKOUT_THRESHOLD = 5;
/** Past this much silence, an unlocked counter restarts from one instead of accumulating. */
export const LOCKOUT_COUNTER_WINDOW_MS = 15 * 60 * 1000;
/** First lockout length; doubles per subsequent strike, then flattens at LOCKOUT_MAX_MS. */
export const LOCKOUT_BASE_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_MS = 4 * 60 * 60 * 1000;

/** Rows untouched for this long are swept by {@link pruneAccountLocks}. */
const LOCK_RETENTION_DAYS = 7;

export interface AccountLockState {
  /** True while the address may not authenticate. */
  locked: boolean;
  lockedUntil: Date | null;
  failedAttempts: number;
  /** Whole seconds until `lockedUntil`, rounded up; 0 when not locked. */
  retryAfterSec: number;
}

const FREE: AccountLockState = { locked: false, lockedUntil: null, failedAttempts: 0, retryAfterSec: 0 };

function toState(row: { failedAttempts: number; lockedUntil: Date | string | null } | undefined, now: number): AccountLockState {
  if (!row) return FREE;
  const until = row.lockedUntil ? new Date(row.lockedUntil) : null;
  const active = !!until && until.getTime() > now;
  return {
    locked: active,
    lockedUntil: active ? until : null,
    failedAttempts: Number(row.failedAttempts ?? 0),
    retryAfterSec: active ? Math.max(1, Math.ceil((until!.getTime() - now) / 1000)) : 0,
  };
}

/**
 * Lock length for a given failure count: 15m, 30m, 1h, 2h, then 4h forever
 * after. Escalation is what makes a sustained guesser expensive without
 * permanently locking a real user who mistyped five times, and it is a pure
 * function so the curve is testable without a database.
 *
 * Returns 0 below the threshold.
 */
export function lockDurationMs(failedAttempts: number, threshold: number = LOCKOUT_THRESHOLD): number {
  if (!Number.isFinite(failedAttempts) || failedAttempts < threshold) return 0;
  const steps = Math.floor(failedAttempts - threshold);
  return Math.min(LOCKOUT_BASE_MS * 2 ** steps, LOCKOUT_MAX_MS);
}

/**
 * Read-only lock check, safe to call before every credential comparison.
 *
 * It writes nothing, which is the property that fixes the self-extending
 * lockout: being rejected for already being locked can no longer postpone the
 * unlock.
 */
export async function readAccountLock(email: string): Promise<AccountLockState> {
  if (!email) return FREE;
  const db = getDb();
  const [row] = await withDbRetry(() =>
    db
      .select({ failedAttempts: accountLocks.failedAttempts, lockedUntil: accountLocks.lockedUntil })
      .from(accountLocks)
      .where(sql`${accountLocks.email} = ${email.toLowerCase()}`)
      .limit(1),
  );
  return toState(row, Date.now());
}

/**
 * Records one genuine credential failure and returns the resulting state.
 *
 * A single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is serialized per
 * email by Postgres, so N parallel failures cannot all observe the same count
 * and each decide they are below the threshold.
 *
 * The counter restarts from one when the previous failure is older than the
 * rolling window, which preserves the "five in fifteen minutes" semantics the
 * old COUNT gave, without the count.
 *
 * An already-active `locked_until` is carried through untouched rather than
 * recomputed, so this cannot lengthen — and, if it were ever called during a
 * lock, could not shorten — a lockout the caller has not observed.
 */
export async function recordAuthFailure(email: string): Promise<AccountLockState> {
  const key = email.toLowerCase();
  const db = getDb();
  const windowSecs = Math.trunc(LOCKOUT_COUNTER_WINDOW_MS / 1000);

  const newCount = sql`(CASE WHEN ${accountLocks.updatedAt} < now() - (${windowSecs}::int * interval '1 second') THEN 1 ELSE ${accountLocks.failedAttempts} + 1 END)`;
  const durationMs = sql`LEAST((${LOCKOUT_BASE_MS}::bigint * power(2, GREATEST((${newCount}) - ${LOCKOUT_THRESHOLD}, 0)))::bigint, ${LOCKOUT_MAX_MS}::bigint)`;

  const [row] = await withDbRetry(() =>
    db
      .insert(accountLocks)
      .values({
        email: key,
        failedAttempts: 1,
        lockedUntil: null,
        lastFailureAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountLocks.email,
        set: {
          failedAttempts: newCount,
          lockedUntil: sql`CASE
              WHEN ${accountLocks.lockedUntil} > now() THEN ${accountLocks.lockedUntil}
              WHEN (${newCount}) >= ${LOCKOUT_THRESHOLD} THEN now() + ((${durationMs}) / 1000.0) * interval '1 second'
              ELSE NULL
            END`,
          lastFailureAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ failedAttempts: accountLocks.failedAttempts, lockedUntil: accountLocks.lockedUntil }),
  );

  return toState(row, Date.now());
}

/**
 * Removes lock state entirely: the counter and the lock together.
 *
 * Called on a successful sign-in (the old implementation left failures behind,
 * so four historical typos put an account one mistake from locked), and by
 * every password-reset path — an admin who resets a locked-out user's
 * credential has obviously intended them to be able to sign in again, and
 * leaving the lock in place would mean the reset appears to succeed while the
 * user still cannot get in.
 */
export async function clearAccountLock(email: string): Promise<boolean> {
  if (!email) return false;
  const db = getDb();
  const deleted = await withDbRetry(() =>
    db.delete(accountLocks).where(sql`${accountLocks.email} = ${email.toLowerCase()}`).returning({ email: accountLocks.email }),
  );
  return deleted.length > 0;
}

/**
 * Sweeps rows for addresses that never came back. One row per email that ever
 * mistyped a password is otherwise permanent growth. Called from the daily
 * cron alongside pruneRateLimitBuckets.
 */
export async function pruneAccountLocks(): Promise<number> {
  const db = getDb();
  const deleted = await withDbRetry(() =>
    db
      .delete(accountLocks)
      .where(sql`${accountLocks.updatedAt} < now() - (${LOCK_RETENTION_DAYS * 24 * 3600}::int * interval '1 second')`)
      .returning({ email: accountLocks.email }),
  );
  return deleted.length;
}
