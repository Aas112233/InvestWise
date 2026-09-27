import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sessions } from '@/db/schema/index';
import { eq, and, desc } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';

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
    const rows = await db
      .select({
        id: sessions.id,
        sessionId: sessions.sessionId,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        locationCountry: sessions.locationCountry,
        locationCity: sessions.locationCity,
        locationRegion: sessions.locationRegion,
        deviceInfo: sessions.deviceInfo,
        osInfo: sessions.osInfo,
        browserInfo: sessions.browserInfo,
        loginTime: sessions.loginTime,
        lastActivity: sessions.lastActivity,
        isActive: sessions.isActive,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(
        and(eq(sessions.userId, userId), eq(sessions.isActive, true)),
      )
      .orderBy(desc(sessions.lastActivity));

    const sessionsData = rows.map((s) => ({
      ...s,
      loginTime: s.loginTime?.toISOString() ?? null,
      lastActivity: s.lastActivity?.toISOString() ?? null,
      createdAt: s.createdAt?.toISOString() ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: { sessions: sessionsData },
    });
  } catch (error: any) {
    console.error('[GET SESSIONS ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get sessions', code: 'SESSIONS_FAILED' },
      { status: 500 }
    );
  }
}