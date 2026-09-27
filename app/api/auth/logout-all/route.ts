import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sessions } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { clearAuthCookies } from '@/lib/utils/cookies';
import { logAudit } from '@/lib/utils/audit';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';

export async function POST(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;

    const db = getDb();

    // End all active sessions
    await db
      .update(sessions)
      .set({
        isActive: false,
        isExpired: true,
        logoutTime: new Date(),
      })
      .where(
        and(eq(sessions.userId, userId), eq(sessions.isActive, true)),
      );

    await logAudit({
      action: 'LOGOUT_ALL_DEVICES',
      resourceType: 'User',
      resourceId: userId,
      status: 'SUCCESS',
    });

    const response = NextResponse.json({
      success: true,
      message: 'Logged out from all devices',
    });

    clearAuthCookies(response.cookies);

    return response;
  } catch (error: any) {
    console.error('[LOGOUT ALL ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Logout from all devices failed', code: 'LOGOUT_ALL_FAILED' },
      { status: 500 }
    );
  }
}