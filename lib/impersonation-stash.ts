import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Server-side authenticity for the impersonation stash cookie.
 *
 * The impersonation-exit path (`DELETE /api/admin/impersonate` without a body)
 * trusts the stash cookie with NO other authentication — that is its design:
 * the caller is the impersonated session, not the platform admin. But a
 * cookie is client-supplied, so an attacker could previously craft one naming
 * any targetSessionId/targetUserId and force-logout that session (live attack
 * rehearsal, 2026-11: victim went 200 → 401 with a hand-forged stash).
 *
 * The fix is to make the stash unforgeable rather than requiring the (possibly
 * already-expired) impersonation token back: the stash is HMAC-signed with a
 * key derived from JWT_SECRET. A forged or tampered stash fails verification
 * and is treated as absent, so the request falls through to the authenticated
 * admin-revoke path. The legitimate expired-cookie exit still works — the
 * signature outlives the 30-minute access cookie (stash max-age is 1h).
 */

export interface StashPayload {
  access: string;
  refresh: string | null;
  targetSessionId: string;
  targetUserId: string;
}

function stashKey(): string {
  // Derived, not raw: the signing key must not equal the JWT signing key even
  // though both live in the same secret. Same derivation discipline as the
  // refresh-secret salt in lib/utils/jwt.ts.
  return createHmac('sha256', process.env.JWT_SECRET ?? '')
    .update('investwise_impersonation_stash_salt_v1')
    .digest('hex');
}

function canonicalize(payload: StashPayload): string {
  // Exact field order + explicit null: the signature must cover the entire
  // value set so swapping ANY field (target ids, access token) breaks it.
  return JSON.stringify({
    access: payload.access,
    refresh: payload.refresh,
    targetSessionId: payload.targetSessionId,
    targetUserId: payload.targetUserId,
  });
}

export function signStash(payload: StashPayload): string {
  return createHmac('sha256', stashKey()).update(canonicalize(payload)).digest('base64url');
}

export function verifyStashSignature(payload: StashPayload, sig: unknown): boolean {
  if (typeof sig !== 'string' || sig.length === 0) return false;
  const expected = Buffer.from(signStash(payload), 'base64url');
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Parse a raw stash cookie value. Returns null unless the JSON parses, the
 * fields are the right shape, AND the signature verifies — anything else is a
 * forged/tampered/stale stash and MUST be treated as absent by the caller.
 */
export function parseSignedStash(
  raw: string | undefined,
): (StashPayload & { sig: string }) | null {
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const access = parsed.access;
  const targetSessionId = parsed.targetSessionId;
  const targetUserId = parsed.targetUserId;
  const refresh = parsed.refresh;
  const sig = parsed.sig;
  if (
    typeof access !== 'string' ||
    typeof targetSessionId !== 'string' ||
    typeof targetUserId !== 'string'
  ) {
    return null;
  }
  const refreshValue = typeof refresh === 'string' ? refresh : null;
  const payload: StashPayload = {
    access,
    refresh: refreshValue,
    targetSessionId,
    targetUserId,
  };
  if (!verifyStashSignature(payload, sig)) return null;
  return { ...payload, sig: sig as string };
}
