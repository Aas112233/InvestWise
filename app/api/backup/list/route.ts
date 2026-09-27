import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Backup listing is an Admin / platform-operator operation.
    const callerRole = normalizeRole(authUser.role);
    if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin access required');
    }

    // In production, this would list from R2. For now, return empty.
    return NextResponse.json({ success: true, backups: [] });
  } catch (error: any) {
    console.error('[BACKUP LIST ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to list backups', code: 'BACKUP_LIST_FAILED' },
      { status: 500 }
    );
  }
}