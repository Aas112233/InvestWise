import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { comparePassword, hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError, NotFoundError, ValidationError } from '@/lib/utils/errors';

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

    const body = await request.json();
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

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
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