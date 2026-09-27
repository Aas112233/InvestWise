import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';

export async function POST(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Backup restore is an Admin / platform-operator operation.
    const callerRole = normalizeRole(authUser.role);
    if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin access required');
    }

    const body = await request.json();
    const { backupKey } = body;

    if (!backupKey) {
      return NextResponse.json(
        { success: false, message: 'backupKey is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // In production, this would download from R2 and restore.
    return NextResponse.json({ success: true, status: 'restore_queued' });
  } catch (error: any) {
    console.error('[BACKUP RESTORE ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Restore failed', code: 'RESTORE_FAILED' },
      { status: 500 }
    );
  }
}