import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sessions, blacklistedTokens } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { verifyToken, blacklistToken } from '@/lib/utils/jwt';
import { tokenHash } from '@/lib/middleware/auth';
import { clearAuthCookies, COOKIE_NAMES } from '@/lib/utils/cookies';
import { logAudit } from '@/lib/utils/audit';
import { getTokenExpiry } from '@/lib/token-expiry';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';

export async function POST(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      // Still wipe cookies: an expired-token logout must not leave stale
      // tokens behind to trap the user in 401s without redirect.
      const denied =
        error ||
        NextResponse.json(
          { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
          { status: 401 }
        );
      clearAuthCookies(denied.cookies);
      return denied;
    }
    const userId = authUser.id;

    // A JSON `null` body parses fine so `.catch()` never fires — normalise to
    // an object before reading fields, or a null body becomes a 500.
    const rawBody = await request.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {} as Record<string, unknown>;
    const refreshToken = request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value || body.refreshToken;
    const accessToken =
      request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    // The session identifier comes only from the verified access token. Never
    // trust a caller-supplied sessionId when deciding which credentials to end.
    const sessionId = accessToken ? verifyToken(accessToken, 'access').sessionId : undefined;
    if (!sessionId) throw new AuthError('Authenticated session is not available', 'TOKEN_REVOKED');

    const db = getDb();

    // Blacklist insert, session end, and audit entry are independent writes —
    // run them as one concurrent round-trip group instead of sequentially.
    await Promise.all([
      // Blacklist the refresh token (a malformed token must not block logout)
      (async () => {
        if (refreshToken) {
          try {
            const expiry = getTokenExpiry(refreshToken);
            await db.insert(blacklistedTokens).values({
              // Store sha256(token) hex, never the raw JWT (leak-safe at rest).
              token: tokenHash(refreshToken),
              type: 'refresh',
              userId,
              expiresAt: expiry,
              reason: 'logout',
            });
            blacklistToken(refreshToken, expiry);
          } catch {
            // If the token is malformed we still proceed to end the session
          }
        }
      })(),
      // End specific session if sessionId provided
      sessionId
        ? db
            .update(sessions)
            .set({
              isActive: false,
              isExpired: true,
              logoutTime: new Date(),
            })
            .where(
              and(eq(sessions.sessionId, sessionId), eq(sessions.userId, userId)),
            )
        : Promise.resolve(),
      logAudit({
        action: 'LOGOUT',
        resourceType: 'User',
        resourceId: userId,
        details: { sessionEnded: Boolean(sessionId) },
        status: 'SUCCESS',
      }),
    ]);

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });

    clearAuthCookies(response.cookies);

    return response;
  } catch (error: any) {
    console.error('[LOGOUT ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Logout failed', code: 'LOGOUT_FAILED' },
      { status: 500 }
    );
  }
}