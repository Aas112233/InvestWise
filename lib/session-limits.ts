// Single source of truth for session lifetime bounds.
//
// Both auth gates (lib/middleware/auth.ts for the modern stack and
// server/src/lib/session.ts for the delegated finance kernel) plus the
// refresh rotation (app/api/auth/refresh/route.ts) enforce these same
// values. They live here — pure constants + date math, no drizzle imports —
// so the server tree can import them without crossing its drizzle boundary.
// No migration needed: the absolute cap anchors on sessions.loginTime and
// the idle cap on sessions.lastActivity, both of which already exist.

/** Absolute cap: a session dies this long after login, however active. */
export const ABSOLUTE_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h

/** Idle policy: the client warns after this long without input. */
export const IDLE_SESSION_LIFETIME_MS = 30 * 60 * 1000; // 30m

/**
 * Server-side grace over the idle policy. The client warning appears at
 * 30m with a 60s countdown; the server must still accept the "Stay signed
 * in" revival past the exact 30m mark (timer throttling, clock skew).
 * Effective server idle kill: 35m without recorded activity.
 */
export const SERVER_IDLE_GRACE_MS = 5 * 60 * 1000; // 5m

/** Impersonation (Support) sessions: hard 30m from login, no grace. */
export const SUPPORT_SESSION_LIFETIME_MS = 30 * 60 * 1000; // 30m

/**
 * sessions.lastActivity is bumped at most this often per session. Auth gates
 * run on every request, so an unthrottled touch would add a write to every
 * read; 5m keeps the idle signal fresh at ~1 extra UPDATE per session per 5m.
 */
export const SESSION_ACTIVITY_TOUCH_THROTTLE_MS = 5 * 60 * 1000; // 5m

/** Refresh requests carrying `<header>: 1` count as user activity. */
export const SESSION_ACTIVITY_HEADER = 'x-session-activity';

/** Cross-tab "last input" timestamp shared via localStorage. */
export const SHARED_ACTIVITY_STORAGE_KEY = 'investwise:last-activity';

type DateLike = Date | string | number | null | undefined;

/** True when the session is older than the absolute cap. Fails closed. */
export function isAbsoluteSessionExpired(loginTime: DateLike, now: number = Date.now()): boolean {
  const t = toTime(loginTime);
  if (t === null) return true;
  return now - t > ABSOLUTE_SESSION_LIFETIME_MS;
}

/**
 * True when idle longer than allowed. Defaults to the server threshold
 * (policy + grace); pass IDLE_SESSION_LIFETIME_MS for the strict policy.
 * Fails closed on missing/unparseable timestamps.
 */
export function isSessionIdle(
  lastActivity: DateLike,
  now: number = Date.now(),
  idleMs: number = IDLE_SESSION_LIFETIME_MS + SERVER_IDLE_GRACE_MS,
): boolean {
  const t = toTime(lastActivity);
  if (t === null) return true;
  return now - t > idleMs;
}

/** True when a Support session is past its hard 30m life. Fails closed. */
export function isSupportSessionExpired(loginTime: DateLike, now: number = Date.now()): boolean {
  const t = toTime(loginTime);
  if (t === null) return true;
  return now - t > SUPPORT_SESSION_LIFETIME_MS;
}

function toTime(v: DateLike): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
