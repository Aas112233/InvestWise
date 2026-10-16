import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { ensureShareValueLocked } from '@/lib/utils/share-value-lock';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    // §6: share-value lock is a per-tenant financial invariant.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const { settings, transactionCount } = await ensureShareValueLocked(tenantId, user);
    if (!settings) {
      return NextResponse.json({ isLocked: false, transactionCount: 0 });
    }

    return NextResponse.json({
      isLocked: Boolean(settings.isShareValueLocked),
      transactionCount,
    });
  } catch (error: any) {
    console.error('[GET SHARE VALUE STATUS ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get share value status', code: 'SHARE_VALUE_STATUS_FAILED' },
      { status: 500 }
    );
  }
}