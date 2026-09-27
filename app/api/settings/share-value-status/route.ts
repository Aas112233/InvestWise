import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { systemSettings, transactions } from '@/db/schema/index';
import { eq, count } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';

interface ShareValueStatus {
  isLocked: boolean;
  transactionCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const db = getDb();

    const [settings] = await db.select().from(systemSettings).limit(1);
    if (!settings) {
      return NextResponse.json({ isLocked: false, transactionCount: 0 });
    }

    const [txResult] = await db
      .select({ count: count() })
      .from(transactions)
      .where(eq(transactions.isDeleted, false));

    const transactionCount = Number(txResult?.count ?? 0);
    let isLocked = Boolean(settings.isShareValueLocked);

    // Auto-lock if transactions exist but not yet locked
    if (transactionCount > 0 && !isLocked) {
      await db
        .update(systemSettings)
        .set({ isShareValueLocked: true, updatedAt: new Date() })
        .where(eq(systemSettings.id, settings.id));

      isLocked = true;
    }

    return NextResponse.json({ isLocked, transactionCount });
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