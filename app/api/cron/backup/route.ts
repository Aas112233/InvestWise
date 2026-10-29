import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/** Mirrors TABLES in app/api/backup/route.ts — reported for contract stability. */
const TABLE_COUNT = 7;

/**
 * GET|POST /api/cron/backup — liveness ping for the backup workflow.
 *
 * This handler used to live at `POST /api/backup`, where it could never run: the
 * edge admits `/api/cron/*` for bearer-token schedulers, but `/api/backup` falls
 * under the normal `/api/*` session check, so a scheduler presenting only
 * `Authorization: Bearer $CRON_SECRET` was rejected before reaching the secret
 * comparison. It failed closed, so nothing was exposed — but the documented
 * contract was broken, and the obvious "fix" (adding `/api/backup` to
 * PUBLIC_PATHS) would have made a money-adjacent route genuinely
 * unauthenticated. Relocating it is the fix that does not create that trap.
 *
 * It is a liveness signal only. The durable backup is the R2 `pg_dump` workflow;
 * this endpoint historically materialised every table into memory and threw the
 * result away (DATA-021 DoS amplifier), which is why it still performs no reads.
 *
 * Authorization comes from the shared `authorizeCronRequest`, which fails closed
 * when CRON_SECRET is unset and compares in constant time, replacing a second
 * private implementation of the same check.
 */
async function ping(request: NextRequest) {
  const cron = authorizeCronRequest(request);
  if (!cron.ok) {
    return NextResponse.json(
      {
        success: false,
        message:
          cron.reason === 'CRON_NOT_CONFIGURED'
            ? 'Backup ping unavailable: CRON_SECRET is not configured'
            : 'Unauthorized: invalid cron secret',
        code: cron.reason,
      },
      { status: 403 },
    );
  }

  console.log(`[cron] Backup ping at ${new Date().toISOString()}`);
  return NextResponse.json({
    success: true,
    status: 'completed',
    tables: TABLE_COUNT,
    timestamp: new Date().toISOString(),
  });
}

export function GET(request: NextRequest) {
  return ping(request);
}

export function POST(request: NextRequest) {
  return ping(request);
}
