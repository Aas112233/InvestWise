import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, sessions } from '@/db/schema/index';
import { and, eq } from 'drizzle-orm';
import { clearAuthCookies } from '@/lib/utils/cookies';
import { comparePassword, hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { getAuthContext } from '@/lib/middleware/auth';
import { logAudit } from '@/lib/utils/audit';
import { clearAccountLock } from '@/lib/account-lock';
import { AuthError, NotFoundError, ValidationError, readJsonBody } from '@/lib/utils/errors';

export async function PUT(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;

    const body = await readJsonBody(request);
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current password and new password are required');
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.message || 'Invalid password');
    }

    const db = getDb();

    const [userWithPw] = await db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userWithPw) {
      throw new NotFoundError('User');
    }

    const valid = await comparePassword(currentPassword, userWithPw.password);
    if (!valid) {
      throw new AuthError('Current password is incorrect', 'INVALID_PASSWORD');
    }

    const hashed = await hashPassword(newPassword);

    await db
      .update(users)
      .set({ password: hashed, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // A password change is the standard response to "someone else has been
    // using my account", so it has to end that access now. Sessions are
    // validated against this row rather than the password, so without this the
    // existing session survives the change for up to the 24h absolute cap.
    // All sessions go, including this one: forcing a fresh sign-in with the new
    // credential is the point of the operation. Requires a full session revoke
    // rather than the caller's current session only, which would need
    // sessionId surfaced on AuthenticatedUser.
    const revokedSessions = await db
      .update(sessions)
      .set({ isActive: false, isExpired: true, logoutTime: new Date() })
      .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)))
      .returning({ sessionId: sessions.sessionId });

    // Getting this far proves the caller knows the current password, so any
    // failed-attempt lockout on the address is stale by definition.
    const lockCleared = await clearAccountLock(authUser.email);

    // Credential change: action-only audit — never snapshot password material.
    await logAudit({
      user: { id: authUser.id, name: authUser.name },
      tenantId: authUser.tenantId ?? null,
      action: 'PASSWORD_CHANGE',
      resourceType: 'User',
      resourceId: userId,
      details: { email: authUser.email, selfService: true, sessionsRevoked: revokedSessions.length },
    });

    const response = NextResponse.json({
      success: true,
      data: { sessionsRevoked: revokedSessions.length },
      message: 'Password changed. Please sign in again.',
    });

    // The session behind these cookies was just revoked above, so leaving the
    // cookies in place would only turn the next request into a confusing 401.
    clearAuthCookies(response.cookies);

    return response;
  } catch (error: any) {
    console.error('[CHANGE PASSWORD ERROR]', error);
    
    if (error instanceof AuthError || error instanceof NotFoundError || error instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Password change failed', code: 'PASSWORD_CHANGE_FAILED' },
      { status: 500 }
    );
  }
}