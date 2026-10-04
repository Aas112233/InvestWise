import { NextRequest, NextResponse } from 'next/server';
import { evaluateSubscriptionExpiry } from '@/lib/superadmin-service';
import { pruneRateLimitBuckets } from '@/lib/rate-limit';
import { authorizeCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/subscription-expiry — automated subscription expiry sweep.
 *
 * Invoked by the Vercel scheduler (see vercel.json crons). Guarded by a shared
 * CRON_SECRET bearer so only the scheduler — or an operator with the secret —
 * can trigger it. Without the secret configured it fails closed with 403 rather
 * than exposing tenant subscription state.
 *
 * Idempotent: re-running over unchanged state reports zero transitions.
 */
export async function GET(request: NextRequest) {
  const cron = authorizeCronRequest(request);
  if (!cron.ok) {
    return NextResponse.json(
      {
        success: false,
        message:
          cron.reason === 'CRON_NOT_CONFIGURED'
            ? 'Expiry sweep unavailable: CRON_SECRET is not configured'
            : 'Unauthorized: invalid cron secret',
        code: cron.reason,
      },
      { status: 403 },
    );
  }

  try {
    const result = await evaluateSubscriptionExpiry();

    // Housekeeping for the abuse counters (rate_limit_buckets): their key space
    // is one row per client IP, so an unswept table turns a security control
    // into a storage problem. Best-effort — a failed prune must not fail the
    // expiry sweep it rides along with.
    let prunedBuckets: number | null = null;
    try {
      prunedBuckets = await pruneRateLimitBuckets();
    } catch (error) {
      console.warn('[SUBSCRIPTION EXPIRY CRON] bucket prune failed:', (error as Error)?.message);
    }

    return NextResponse.json({ success: true, data: { ...result, prunedBuckets } });
  } catch (error) {
    console.error('[SUBSCRIPTION EXPIRY CRON ERROR]', error);
    return NextResponse.json(
      { success: false, message: 'Subscription expiry evaluation failed', code: 'EXPIRY_FAILED' },
      { status: 500 },
    );
  }
}
