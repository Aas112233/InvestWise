import { NextRequest, NextResponse } from 'next/server';
import { sweepAllGovernanceTenants } from '@/lib/governance/status-service';
import { authorizeCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/governance-sweep — daily member-status sweep.
 *
 * Applies only the automatic half of the lifecycle, per tenant:
 *   active   -> inactive (hold)   past `inactiveAfterMonths` with no deposit
 *   inactive -> active            once no due period owes money
 *
 * It never suspends and never reinstates: both block or restore portal login,
 * so they stay explicit admin actions. The sweep only reports
 * `suspensionEligible` / `reinstateRecommended` counts for an admin to act on.
 *
 * Guarded by CRON_SECRET and fails closed with 403 when the secret is unset.
 * Idempotent — re-running over unchanged state reports zero transitions.
 */
export async function GET(request: NextRequest) {
  const cron = authorizeCronRequest(request);
  if (!cron.ok) {
    return NextResponse.json(
      {
        success: false,
        message:
          cron.reason === 'CRON_NOT_CONFIGURED'
            ? 'Governance sweep unavailable: CRON_SECRET is not configured'
            : 'Unauthorized: invalid cron secret',
        code: cron.reason,
      },
      { status: 403 },
    );
  }

  try {
    const result = await sweepAllGovernanceTenants({
      actor: { name: 'Governance sweep (cron)' },
    });

    const failed = result.results.filter((r) => !r.ok);
    return NextResponse.json({
      success: failed.length === 0,
      data: result,
      // A partial run must not read as a clean one.
      ...(failed.length > 0
        ? { message: `${failed.length} tenant(s) failed to sweep`, code: 'PARTIAL_SWEEP' }
        : {}),
    });
  } catch (error) {
    console.error('[GOVERNANCE SWEEP CRON ERROR]', error);
    return NextResponse.json(
      { success: false, message: 'Governance sweep failed', code: 'SWEEP_FAILED' },
      { status: 500 },
    );
  }
}
