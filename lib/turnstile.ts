const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

/**
 * Cloudflare's documented *always-pass* test keys. A deployment that ships with
 * one of these has human proof that proves nothing, so production refuses to use
 * them instead of silently trusting them.
 */
const TEST_VECTORS = new Set([
  '1x0000000000000000000000000000000',
  '1e00000000000000000000AA',
  '2x00000000000000000000AB',
  '3x00000000000000000000FF',
  'a100000000000000000000AA',
  'b100000000000000000000AA',
]);

export type TurnstileState =
  /** Secret configured: a valid token is mandatory. */
  | { mode: 'required' }
  /** Nothing configured, non-production: form renders without the widget. */
  | { mode: 'skipped'; reason: string }
  /** Nothing (or only a test vector) configured in production: reject signup. */
  | { mode: 'unavailable'; reason: string };

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Bot-protection posture for public, unauthenticated write endpoints.
 *
 * Fails closed in production on purpose. Missing configuration is an incident,
 * not a licence to run an unthrottled-by-human tenant-creation endpoint — the
 * per-IP/email/global counters are crude instruments next to a scripted client,
 * and rotating an IP header costs an attacker nothing.
 */
export function turnstileState(): TurnstileState {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return isProduction
      ? { mode: 'unavailable', reason: 'TURNSTILE_SECRET_KEY is not configured' }
      : { mode: 'skipped', reason: 'bot protection not configured in development' };
  }

  if (TEST_VECTORS.has(secret)) {
    return isProduction
      ? { mode: 'unavailable', reason: 'TURNSTILE_SECRET_KEY is a Cloudflare test vector' }
      : { mode: 'skipped', reason: 'using the Cloudflare always-pass test secret' };
  }

  return { mode: 'required' };
}

export type TurnstileVerdict = { ok: true } | { ok: false; code: string; message: string };

/**
 * Server-side redemption of the browser token. Single use at Cloudflare, so a
 * captured token cannot be replayed against us; any failure — network, timeout,
 * bad payload — is a denial.
 */
export async function verifyTurnstileToken(
  token: unknown,
  clientIp: string,
): Promise<TurnstileVerdict> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2_000) {
    return { ok: false, code: 'CAPTCHA_MISSING', message: 'Bot verification is required.' };
  }

  const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? '', response: token });
  const expectedHost = process.env.TURNSTILE_HOSTNAME;
  if (expectedHost) form.set('hostname', expectedHost);
  if (clientIp && clientIp !== 'unknown') form.set('remoteip', clientIp);

  let payload: { success?: boolean; 'error-codes'?: string[] };
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    payload = await res.json();
  } catch (error) {
    // Never log the token or the secret; the outcome is already "deny".
    console.warn('[TURNSTILE] verification request failed:', (error as Error)?.name ?? 'Error');
    return { ok: false, code: 'CAPTCHA_UNAVAILABLE', message: 'Bot verification is unavailable. Please retry.' };
  }

  if (payload?.success !== true) {
    return { ok: false, code: 'CAPTCHA_INVALID', message: 'Bot verification failed. Please retry.' };
  }

  return { ok: true };
}
