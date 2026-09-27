import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { blacklistedTokens } from '@/db/schema/index';
import { AuthError, ForbiddenError, AppError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { issueImpersonationToken, logSuperAdminAction, IMPERSONATION_TOKEN_TTL } from '@/lib/superadmin-service';
import { verifyToken, blacklistToken } from '@/lib/utils/jwt';
import { getTokenExpiry } from '@/lib/token-expiry';

// POST /api/admin/impersonate { userId } — platform-only.
// Returns a 30-minute access token for the TARGET user with impersonatedBy
// set to the platform admin. The client keeps its own admin session and uses
// this token explicitly (e.g. Authorization header); exiting discards it.
// Issue + revoke are recorded in super_admin_action_log with both identities,
// the operator's IP and user-agent; in-tenant actions during the session
// attribute to the target user.
// Same header precedence as the login route: proxy chain first, then direct
// peer. null (not '0.0.0.0') when absent — unknown beats a fake IP in an
// audit column.
function getClientIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;
}

export async function POST(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const { userId } = body;
    if (!userId) {
      return NextResponse.json(
        { success: false, message: 'userId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const session = await issueImpersonationToken(
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

    return NextResponse.json({
      success: true,
      data: { token: session.token, expiresIn: IMPERSONATION_TOKEN_TTL, tenantId: session.tenantId },
    });
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

// DELETE /api/admin/impersonate { token } — platform-only revoke. The token
// hits the existing blacklist machinery, so any further use is rejected.
export async function DELETE(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const body = await request.json();
    const { token } = body;
    if (!token) {
      return NextResponse.json(
        { success: false, message: 'token is required', code: 'VALIDATION_ERROR' },
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
      details: { userAgent: request.headers.get('user-agent') },
    });

    return NextResponse.json({ success: true, message: 'Impersonation session revoked' });
  } catch (error: unknown) {
    console.error('[IMPERSONATE REVOKE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.statusCode ?? 500 });
    }
    return NextResponse.json({ success: false, message: 'Revoke failed', code: 'IMPERSONATE_REVOKE_FAILED' }, { status: 500 });
  }
}
