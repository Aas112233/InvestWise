import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, sessions, blacklistedTokens } from '@/db/schema/index';
import { eq, and, gte, isNull, ne, or, gt } from 'drizzle-orm';
import { verifyToken, generateTokenPair, blacklistToken } from '@/lib/utils/jwt';
import { tokenHash } from '@/lib/middleware/auth';
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { setAuthCookies, COOKIE_NAMES } from '@/lib/utils/cookies';
import { getTokenExpiry } from '@/lib/token-expiry';
import { AppError, AuthError } from '@/lib/utils/errors';
import { normalizeRole } from '@/lib/roles';
import crypto from 'node:crypto';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, message: 'Refresh token is required', code: 'MISSING_REFRESH_TOKEN' },
        { status: 400 }
      );
    }

    // Verify JWT
    let decoded: { id: string; type: 'access' | 'refresh'; sessionId?: string; impersonatedBy?: string };
    try {
      decoded = verifyToken(refreshToken, 'refresh');
    } catch (error: any) {
      return NextResponse.json(
        { success: false, message: error.message || 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' },
        { status: 401 }
      );
    }

    const db = getDb();

    if (!decoded.sessionId) {
      throw new AuthError('Refresh token is not bound to an active session', 'TOKEN_REVOKED');
    }

    // Resolve blacklist status and session revocation from the same indexed
    // query. Refresh and user lookup run concurrently, but tokens are not
    // minted unless the persisted session is still active.
    const [[sessionState], [user]] = await Promise.all([
      db
        .select({ blacklistId: blacklistedTokens.id })
        .from(sessions)
        .leftJoin(
          blacklistedTokens,
          // Rows store sha256(token) hex (see tokenHash) — hash before matching.
          and(eq(blacklistedTokens.token, tokenHash(refreshToken)), gte(blacklistedTokens.expiresAt, new Date())),
        )
        .where(
          and(
            eq(sessions.sessionId, decoded.sessionId),
            eq(sessions.userId, decoded.id),
            eq(sessions.isActive, true),
            eq(sessions.isExpired, false),
            or(
              isNull(sessions.deviceInfo),
              ne(sessions.deviceInfo, 'Support'),
              gt(sessions.loginTime, new Date(Date.now() - 30 * 60_000)),
            ),
          ),
        )
        .limit(1),
      db
        .select({ id: users.id, status: users.status, role: users.role, email: users.email, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, decoded.id))
        .limit(1),
    ]);

    if (!sessionState || sessionState.blacklistId) {
      throw new AuthError('Refresh token or session has been revoked', 'TOKEN_REVOKED');
    }

    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    if (user.status === 'suspended' || user.status === 'inactive') {
      throw new AuthError(
        `Account is ${user.status}`,
        user.status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_INACTIVE',
      );
    }

    // Rotate the SESSION identity, not just the token: reusing
    // `decoded.sessionId` would keep a stolen-but-unused refresh token alive
    // for the full refresh lifetime (7d) because only the individual token is
    // blacklisted, never the session binding. Mint a fresh session id, carry
    // it into both new tokens, and move the persisted session row onto it in
    // the same step that records the rotation.
    const rotatedSessionId = crypto.randomUUID();

    // Rotate: record the blacklist entry, re-key the session row, and resolve
    // the subscription gate concurrently — token signing waits on all three
    // (the verdict is baked into the claims, and rotation must be persisted
    // before new tokens are issued).
    const expiry = getTokenExpiry(refreshToken);
    const [, , subscriptionBlocked] = await Promise.all([
      (async () => {
        try {
          await db.insert(blacklistedTokens).values({
            token: tokenHash(refreshToken),
            type: 'refresh',
            userId: decoded.id,
            expiresAt: expiry,
            reason: 'rotation',
          });
          blacklistToken(refreshToken, expiry);
        } catch (insertError: any) {
          if (insertError?.code === '23505') {
            throw new AuthError('Token has been revoked or already rotated', 'TOKEN_REVOKED');
          }
          // A CHECK violation here (23514) means the DB constraint vocabulary
          // drifted from this code — that was the ``reason='rotation'`` bug that
          // silently 500'd every refresh and logged users out every 15 minutes
          // (migration 0011 widened the constraint). Surface it as an explicit,
          // actionable server fault rather than a generic REFRESH_FAILED, and
          // keep the raw DB detail in the log only.
          console.error('[blacklist INSERT failed]', {
            code: insertError.code,
            detail: insertError.detail,
            constraint: insertError.constraint,
            column: insertError.column,
            message: insertError.message,
          });
          if (insertError?.code === '23514') {
            throw new AppError(
              'Token rotation is not permitted by the database constraint (blacklisted_tokens_reason_check). Apply migration 0011_blacklist_rotation_reason.sql.',
              500,
              'ROTATION_CONSTRAINT_VIOLATION',
            );
          }
          throw insertError;
        }
      })(),
      db
        .update(sessions)
        .set({ sessionId: rotatedSessionId, lastActivity: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(sessions.sessionId, decoded.sessionId),
            eq(sessions.userId, decoded.id),
            eq(sessions.isActive, true),
            eq(sessions.isExpired, false),
          ),
        ),
      getTenantSubscriptionBlocked(user.tenantId ?? null),
    ]);

    const tokens = generateTokenPair(decoded.id, {
      role: normalizeRole(user.role),
      email: user.email,
      tenantId: user.tenantId ?? null,
      subscriptionBlocked,
      sessionId: rotatedSessionId,
      impersonatedBy: decoded.impersonatedBy,
    });

    // Rotated tokens are delivered exclusively via HttpOnly cookies; echoing
    // them in the body would re-expose them to XSS and log capture.
    const response = NextResponse.json({ success: true });

    setAuthCookies(response.cookies, tokens.accessToken, tokens.refreshToken);

    return response;
  } catch (error: any) {
    console.error('[REFRESH ERROR]', error);
    
    if (error instanceof AppError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Token refresh failed', code: 'REFRESH_FAILED' },
      { status: 500 }
    );
  }
}