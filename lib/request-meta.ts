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
 * Client IP for abuse controls.
 *
 * Only headers that this deployment's own edge stamps are trusted, because a
 * throttle keyed on anything else is a suggestion: Vercel sets
 * `x-vercel-forwarded-for` itself and will not let a client overwrite it, while
 * `x-real-ip` and `cf-connecting-ip` are never set by Vercel at all — so any
 * value present in them arrived in the request and is attacker-chosen. Reading
 * them first (as this function used to) let one request header buy a fresh rate
 * limit bucket per request, and spawned a new `rate_limit_buckets` row each
 * time: the abuse control became the storage problem it exists to prevent.
 *
 * `x-forwarded-for` is deliberately not consulted either. Each proxy PREPENDS,
 * so its first entry is whatever the caller sent unless every hop normalises
 * it, and this app has no such hop.
 *
 * With no trustworthy header the answer is 'unknown', which every caller maps
 * to its own (wider but finite) ceiling — so local development and any
 * non-Vercel deployment still get a bound, just a looser one. Never add a
 * client-controlled header back to this list without also stripping it in
 * middleware.ts.
 */
export function getAbuseClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
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
