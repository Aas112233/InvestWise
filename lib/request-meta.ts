import type { NextRequest } from 'next/server';
import { ValidationError } from '@/lib/utils/errors';

// Client IP for audit rows. Behind Vercel/any proxy, x-forwarded-for is a
// comma list and the FIRST entry is the original client. Falls back to
// x-real-ip, then null — never fabricate an address.
export function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}

/**
 * Client IP for abuse controls, with the spoofable header last.
 *
 * `x-forwarded-for`'s first entry is whatever the caller sent whenever a hop in
 * front of the app does not normalize it, so a throttle keyed on it alone can be
 * bypassed by adding one request header. Headers a platform edge stamps on the
 * request win; the raw socket address would win outright but is not exposed to
 * Next route handlers.
 *
 * Still best-effort by design: never make this the only dimension a limit is
 * keyed on (see app/api/auth/signup, which also keys on email and a global
 * ceiling plus a human-proof token).
 */
export function getAbuseClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Bounded JSON body read for public endpoints.
 *
 * `content-length` is a request header any client can omit or lie about, so the
 * cap is applied to the bytes actually read — same contract as the signup
 * route. Throwing ValidationError (an AppError) lets route handlers answer with
 * their standard 400/500 branches; both failure messages are policy text safe
 * to surface.
 */
export async function readCappedJson(request: NextRequest, maxBytes: number): Promise<unknown> {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) {
    throw new ValidationError('Request body is too large');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError('Request body must be JSON');
  }
}

/**
 * Client-controlled free-text clamped to a column-safe length. Prevents both
 * oversized-value 500s (varchar overflow) and junk bloat in attempt/session
 * telemetry. Non-strings become null — a missing field is absence, not text.
 */
export function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}
