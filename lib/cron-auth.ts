import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Shared CRON_SECRET bearer check for /api/cron/* routes.
 *
 * Fails closed when the secret is unset — an unconfigured deployment must not
 * expose sweeps, and callers distinguish "not configured" from "unauthorized"
 * so the operator sees which one they are looking at.
 *
 * The comparison is timing-safe over length-matched buffers. A plain string
 * !== leaks byte-by-byte match progress in principle; network jitter makes
 * that impractical to exploit, but the constant-time compare costs nothing
 * and removes the class entirely. Comparing lengths first leaks only the
 * header length, never secret content — the accepted standard for
 * timingSafeEqual, which throws on mismatched lengths.
 */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: 'CRON_NOT_CONFIGURED' | 'UNAUTHORIZED' };

export function authorizeCronRequest(request: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, reason: 'CRON_NOT_CONFIGURED' };
  }

  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const provided = Buffer.from(authHeader, 'utf8');
  const required = Buffer.from(expected, 'utf8');

  if (provided.length !== required.length) {
    return { ok: false, reason: 'UNAUTHORIZED' };
  }
  return timingSafeEqual(provided, required)
    ? { ok: true }
    : { ok: false, reason: 'UNAUTHORIZED' };
}
