import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { sessions } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError, NotFoundError } from '@/lib/utils/errors';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;

    const { sessionId } = await params;

    const db = getDb();
    const [updated] = await db
      .update(sessions)
      .set({
        isActive: false,
        isExpired: true,
        logoutTime: new Date(),
      })
      .where(
        and(
          eq(sessions.sessionId, sessionId),
          eq(sessions.userId, userId),
          eq(sessions.isActive, true),
        ),
      )
      .returning({ id: sessions.id });

    if (!updated) {
      throw new NotFoundError('Session');
    }

    return NextResponse.json({
      success: true,
      message: 'Session revoked successfully',
    });
  } catch (error: any) {
    console.error('[REVOKE SESSION ERROR]', error);
    
    if (error instanceof AuthError || error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to revoke session', code: 'REVOKE_FAILED' },
      { status: 500 }
    );
  }
}