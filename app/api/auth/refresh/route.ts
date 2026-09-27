import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, blacklistedTokens } from '@/db/schema/index';
import { eq, and, gte } from 'drizzle-orm';
import { verifyToken, generateTokenPair, blacklistToken } from '@/lib/utils/jwt';
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { setAuthCookies, COOKIE_NAMES } from '@/lib/utils/cookies';
import { getTokenExpiry } from '@/lib/token-expiry';
import { AuthError } from '@/lib/utils/errors';
import { normalizeRole } from '@/lib/roles';

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
    let decoded: { id: string; type: 'access' | 'refresh' };
    try {
      decoded = verifyToken(refreshToken, 'refresh');
    } catch (error: any) {
      return NextResponse.json(
        { success: false, message: error.message || 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' },
        { status: 401 }
      );
    }

    const db = getDb();

    // Check blacklist in DB
    const [blacklisted] = await db
      .select({ id: blacklistedTokens.id })
      .from(blacklistedTokens)
      .where(
        and(
          eq(blacklistedTokens.token, refreshToken),
          gte(blacklistedTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (blacklisted) {
      throw new AuthError('Refresh token has been revoked', 'TOKEN_REVOKED');
    }

    // Verify user still exists and is active
    const [user] = await db
      .select({ id: users.id, status: users.status, role: users.role, email: users.email, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    if (user.status === 'suspended' || user.status === 'inactive') {
      throw new AuthError(
        `Account is ${user.status}`,
        user.status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_INACTIVE',
      );
    }

    // Rotate: blacklist old token, generate new pair
    const expiry = getTokenExpiry(refreshToken);
    try {
      await db.insert(blacklistedTokens).values({
        token: refreshToken,
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
      console.error('[blacklist INSERT failed]', {
        code: insertError.code,
        detail: insertError.detail,
        constraint: insertError.constraint,
        column: insertError.column,
        message: insertError.message,
      });
      throw insertError;
    }

    const tokens = generateTokenPair(decoded.id, {
      role: normalizeRole(user.role),
      email: user.email,
      tenantId: user.tenantId ?? null,
      subscriptionBlocked: await getTenantSubscriptionBlocked(user.tenantId ?? null),
    });

    const response = NextResponse.json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

    setAuthCookies(response.cookies, tokens.accessToken, tokens.refreshToken);

    return response;
  } catch (error: any) {
    console.error('[REFRESH ERROR]', error);
    
    if (error instanceof AuthError) {
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