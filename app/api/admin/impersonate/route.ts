import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { and, eq } from 'drizzle-orm';
import { blacklistedTokens, sessions } from '@/db/schema/index';
import { AuthError, ForbiddenError, AppError, readJsonBody } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import {
  issueImpersonationSession,
  logSuperAdminAction,
  IMPERSONATION_TOKEN_TTL,
  type ImpersonationSession,
} from '@/lib/superadmin-service';
import { verifyToken, blacklistToken } from '@/lib/utils/jwt';
import { tokenHash } from '@/lib/middleware/auth';
import { getTokenExpiry } from '@/lib/token-expiry';
import { getClientIp } from '@/lib/request-meta';
import { COOKIE_NAMES } from '@/lib/utils/cookies';

// POST /api/admin/impersonate { userId } — platform-only.
//
// The credential is delivered as an HttpOnly cookie and NEVER in the JSON body
// for browser use: a token rendered into the DOM is readable by any injected
// script, lands in React state and the clipboard, and is visible on screen.
// The operator's own session is stashed first so DELETE can restore it.
//
// Issue + revoke land in super_admin_action_log with both identities, the
// operator's IP and user-agent. In-tenant actions during the session attribute
// to the target user, with the platform admin retained as impersonatedBy.

const STASH_COOKIE = 'impersonationAdminSession';
const STASH_MAX_AGE = 60 * 60; // 1h — longer than the 30m session it restores

// Shape persisted in the stash cookie. A named type, because annotating the
// DELETE parser with `typeof stashed` self-references (it resolves to `never`
// while its own initializer is being checked) and breaks the build.
interface StashedAdminSession {
  access: string;
  refresh: string | null;
  targetSessionId: string;
  targetUserId: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function stashAdminSession(response: NextResponse, request: NextRequest, target: ImpersonationSession): void {
  const access = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  const refresh = request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value;
  if (!access) return;
  response.cookies.set(
    STASH_COOKIE,
    JSON.stringify({
      access,
      refresh: refresh ?? null,
      targetSessionId: target.sessionId,
      targetUserId: target.targetUserId,
    }),
    {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    maxAge: STASH_MAX_AGE,
    path: '/',
  });
}

function applyTargetSession(response: NextResponse, session: ImpersonationSession): void {
  response.cookies.set(COOKIE_NAMES.ACCESS_TOKEN, session.accessToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    maxAge: 30 * 60,
    path: '/',
  });
  response.cookies.set(COOKIE_NAMES.REFRESH_TOKEN, session.refreshToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? 'strict' : 'lax',
    maxAge: 30 * 60,
    path: '/api/auth',
  });
}

export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await readJsonBody(request);
    const { userId } = body;
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          message: "[Field 'userId', Code: invalid_type] userId is required",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }

    const session = await issueImpersonationSession(
      { id: platformUser.id, email: platformUser.email },
      userId,
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'TENANT_IMPERSONATE_START',
      targetType: 'User',
      targetId: userId,
      tenantId: session.tenantId,
      details: {
        targetEmail: session.email,
        userAgent: request.headers.get('user-agent'),
      },
    });

    const response = NextResponse.json({
      success: true,
      data: {
        targetUserId: session.targetUserId,
        targetEmail: session.email,
        tenantId: session.tenantId,
        expiresIn: IMPERSONATION_TOKEN_TTL,
      },
    });

    stashAdminSession(response, request, session);
    applyTargetSession(response, session);
    return response;
  } catch (error: unknown) {
    console.error('[IMPERSONATE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof AppError || error instanceof Error) {
      const e = error as { message: string; code?: string; statusCode?: number };
      const status = e.statusCode ?? (/not found|Cannot impersonate/i.test(e.message) ? 400 : 500);
      return NextResponse.json({ success: false, message: e.message, code: e.code ?? 'IMPERSONATE_FAILED' }, { status });
    }
    return NextResponse.json({ success: false, message: 'Impersonation failed', code: 'IMPERSONATE_FAILED' }, { status: 500 });
  }
}

// DELETE /api/admin/impersonate — platform-only. Two modes:
//
//   {}                    exit the active session: restore the stashed platform
//                         admin cookies, blacklisting the impersonation tokens
//                         so a copy already in circulation dies immediately.
//   { token }             revoke one specific leaked token by blacklisting it.
//
// Blacklist (not just cookie-clear) on the exit path is deliberate: the
// impersonation token was a live credential for up to 30 minutes, and clearing
// a cookie does nothing to a copy someone else took.
export async function DELETE(request: NextRequest) {
  try {
    const raw = await request.text();
    const body = raw ? (JSON.parse(raw) as { token?: string }) : {};
    const token = body?.token;

    const stashRaw = request.cookies.get(STASH_COOKIE)?.value;
    let stashed: StashedAdminSession | null = null;
    if (stashRaw) {
      try {
        const parsed = JSON.parse(stashRaw) as Partial<StashedAdminSession>;
        if (
          typeof parsed.access === 'string' &&
          typeof parsed.targetSessionId === 'string' &&
          typeof parsed.targetUserId === 'string'
        ) {
          stashed = {
            access: parsed.access,
            refresh: typeof parsed.refresh === 'string' ? parsed.refresh : null,
            targetSessionId: parsed.targetSessionId,
            targetUserId: parsed.targetUserId,
          };
        }
      } catch {
        stashed = null;
      }
    }

    // Exit path requires no body and no admin auth: the caller is the
    // IMPERSONATED session, which by definition is not a platform admin.
    if (!token && stashed) {
      const db = getDb();
      const current = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;

      // The stash carries the random target session id so exit still revokes
      // the session if the 30-minute access cookie has already expired. Do not
      // restore the platform cookies unless PostgreSQL confirms this write.
      await db
        .update(sessions)
        .set({ isActive: false, isExpired: true, logoutTime: new Date() })
        .where(
          and(
            eq(sessions.sessionId, stashed.targetSessionId),
            eq(sessions.userId, stashed.targetUserId),
          ),
        );

      if (current) {
        // Best-effort token blacklist is defense in depth; the inactive session
        // is the authoritative revocation and has already been persisted.
        try {
          const decoded = verifyToken(current, 'access');
          if (decoded.id === stashed.targetUserId && decoded.sessionId === stashed.targetSessionId) {
            const expiry = getTokenExpiry(current);
            await db.insert(blacklistedTokens).values({
              // sha256 hex at rest, consistent with every blacklist read path.
              token: tokenHash(current),
              type: 'access',
              userId: decoded.id,
              expiresAt: expiry,
              reason: 'impersonation_exit',
            });
            blacklistToken(current, expiry);
          }
        } catch {
          // A missing, expired, or already-blacklisted access token is harmless
          // after the associated session has been marked inactive.
        }
      }

      const response = NextResponse.json({
        success: true,
        message: 'Exited impersonation',
        data: { redirectTo: '/admin' },
      });
      response.cookies.set(COOKIE_NAMES.ACCESS_TOKEN, stashed.access, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? 'strict' : 'lax',
        maxAge: 15 * 60,
        path: '/',
      });
      if (stashed.refresh) {
        response.cookies.set(COOKIE_NAMES.REFRESH_TOKEN, stashed.refresh, {
          httpOnly: true,
          secure: isProduction(),
          sameSite: isProduction() ? 'strict' : 'lax',
          maxAge: 7 * 24 * 60 * 60,
          path: '/api/auth',
        });
      } else {
        response.cookies.delete(COOKIE_NAMES.REFRESH_TOKEN);
      }
      response.cookies.delete(STASH_COOKIE);
      return response;
    }

    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'No active impersonation session to exit', code: 'NO_SESSION' },
        { status: 400 },
      );
    }

    let targetId = 'unknown';
    let sessionId: string | undefined;
    try {
      const decoded = verifyToken(token, 'access');
      targetId = decoded.id;
      sessionId = decoded.sessionId;
    } catch {
      // Already invalid/expired — still record the revoke attempt.
    }

    const db = getDb();
    const expiry = getTokenExpiry(token);
    if (sessionId && targetId !== 'unknown') {
      await db
        .update(sessions)
        .set({ isActive: false, isExpired: true, logoutTime: new Date() })
        .where(and(eq(sessions.sessionId, sessionId), eq(sessions.userId, targetId)));
    }
    await db.insert(blacklistedTokens).values({
      // sha256 hex at rest, consistent with every blacklist read path.
      token: tokenHash(token),
      type: 'access',
      userId: platformUser.id,
      expiresAt: expiry,
      reason: 'impersonation_revoke',
    });
    blacklistToken(token, expiry);

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'TENANT_IMPERSONATE_END',
      targetType: 'User',
      targetId,
      details: { userAgent: request.headers.get('user-agent'), via: 'explicit_revoke' },
    });

    const response = NextResponse.json({ success: true, message: 'Impersonation session revoked' });
    if (stashed) response.cookies.delete(STASH_COOKIE);
    return response;
  } catch (error: unknown) {
    console.error('[IMPERSONATE REVOKE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, message: 'Revoke failed', code: 'IMPERSONATE_REVOKE_FAILED' }, { status: 500 });
  }
}
