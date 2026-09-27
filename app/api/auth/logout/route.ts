import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sessions, blacklistedTokens } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { verifyToken, blacklistToken } from '@/lib/utils/jwt';
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

    const body = await request.json().catch(() => ({}));
    const refreshToken = request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value || body.refreshToken;
    const sessionId = body.sessionId;

    const db = getDb();

    // Blacklist the refresh token
    if (refreshToken) {
      try {
        const expiry = getTokenExpiry(refreshToken);
        await db.insert(blacklistedTokens).values({
          token: refreshToken,
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

    // End specific session if sessionId provided
    if (sessionId) {
      await db
        .update(sessions)
        .set({
          isActive: false,
          isExpired: true,
          logoutTime: new Date(),
        })
        .where(
          and(eq(sessions.sessionId, sessionId), eq(sessions.userId, userId)),
        );
    }

    await logAudit({
      action: 'LOGOUT',
      resourceType: 'User',
      resourceId: userId,
      details: { sessionEnded: Boolean(sessionId) },
      status: 'SUCCESS',
    });

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