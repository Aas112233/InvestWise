import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { blacklistedTokens } from '@/db/schema/index';
import { AuthError, ForbiddenError, AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import {
  issueImpersonationSession,
  logSuperAdminAction,
  IMPERSONATION_TOKEN_TTL,
  type ImpersonationSession,
} from '@/lib/superadmin-service';
import { verifyToken, blacklistToken } from '@/lib/utils/jwt';
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

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function stashAdminSession(response: NextResponse, request: NextRequest): void {
  const access = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;
  const refresh = request.cookies.get(COOKIE_NAMES.REFRESH_TOKEN)?.value;
  if (!access) return;
  response.cookies.set(STASH_COOKIE, JSON.stringify({ access, refresh: refresh ?? null }), {
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

    const body = await request.json();
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

    stashAdminSession(response, request);
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
    let stashed: { access: string; refresh: string | null } | null = null;
    if (stashRaw) {
      try {
        stashed = JSON.parse(stashRaw) as { access: string; refresh: string | null };
      } catch {
        stashed = null;
      }
    }

    // Exit path requires no body and no admin auth: the caller is the
    // IMPERSONATED session, which by definition is not a platform admin.
    if (!token && stashed) {
      const db = getDb();
      const current = request.cookies.get(COOKIE_NAMES.ACCESS_TOKEN)?.value;

      if (current) {
        // blacklisted_tokens.user_id is NOT NULL and must name the token's
        // OWNER, not the platform admin — so decode it from the token. An
        // undecodable token (already expired/revoked) is skipped rather than
        // written under a wrong owner; the in-memory blacklist still applies.
        try {
          const ownerId = verifyToken(current, 'access').id;
          const expiry = getTokenExpiry(current);
          await db.insert(blacklistedTokens).values({
            token: current,
            type: 'access',
            userId: ownerId,
            expiresAt: expiry,
            reason: 'impersonation_exit',
          });
          blacklistToken(current, expiry);
        } catch {
          // Never block the restore on a blacklist write.
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
    try {
      const decoded = verifyToken(token, 'access');
      targetId = decoded.id;
    } catch {
      // Already invalid/expired — still record the revoke attempt.
    }

    const db = getDb();
    const expiry = getTokenExpiry(token);
    await db.insert(blacklistedTokens).values({
      token,
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
