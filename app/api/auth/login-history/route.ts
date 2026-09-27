import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, loginAttempts } from '@/db/schema/index';
import { eq, desc } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError, NotFoundError } from '@/lib/utils/errors';

const MAX_LOGIN_HISTORY = 50;

export async function GET(request: NextRequest) {
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

    // Get user email first
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const rows = await db
      .select({
        id: loginAttempts.id,
        email: loginAttempts.email,
        ipAddress: loginAttempts.ipAddress,
        success: loginAttempts.success,
        failureReason: loginAttempts.failureReason,
        timestamp: loginAttempts.timestamp,
        userAgent: loginAttempts.userAgent,
        locationCountry: loginAttempts.locationCountry,
        locationCity: loginAttempts.locationCity,
      })
      .from(loginAttempts)
      .where(eq(loginAttempts.email, user.email))
      .orderBy(desc(loginAttempts.timestamp))
      .limit(MAX_LOGIN_HISTORY);

    const loginHistory = rows.map((r) => ({
      ...r,
      timestamp: r.timestamp?.toISOString() ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: { loginHistory },
    });
  } catch (error: any) {
    console.error('[LOGIN HISTORY ERROR]', error);
    
    if (error instanceof AuthError || error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get login history', code: 'LOGIN_HISTORY_FAILED' },
      { status: 500 }
    );
  }
}