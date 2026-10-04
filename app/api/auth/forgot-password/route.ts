import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '@/lib/utils/types';
import { logAudit } from '@/lib/utils/audit';
import { bucketKey, consumeBucket, type BucketOutcome } from '@/lib/rate-limit';
import { getAbuseClientIp, readCappedJson } from '@/lib/request-meta';

// Public, unauthenticated endpoint. There is no outbound email provider yet:
// a request here is recorded for the administrators, who handle recovery
// manually. That makes the audit write load-bearing (it IS the feature), and
// it runs on every request regardless of account existence — the previous
// write-only-when-found behavior made response timing an account-existence
// oracle on a financial system. Budgets: a human requests recovery for
// themselves, occasionally.
const MAX_BODY_BYTES = 4 * 1024;
const IP_LIMIT = 5;
const IP_WINDOW_SECS = 15 * 60;
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_SECS = 60 * 60;
const UNKNOWN_IP_LIMIT = 20;
const EMAIL_MAX_LENGTH = 254;

function tooManyRequests(outcome: BucketOutcome) {
  return NextResponse.json(
    { success: false, message: 'Too many recovery requests. Please try again later.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } },
  );
}

function rateCounterUnavailable() {
  // Fail closed: a throttle that cannot be consulted denies, it does not log.
  console.error('[FORGOT PASSWORD] rate counter unavailable, denying request');
  return NextResponse.json(
    { success: false, message: 'Too many requests right now. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  try {
    // Spend the address budget alongside the capped body read (independent
    // operations, no sequential latency add), before any database work.
    const ip = getAbuseClientIp(request);
    const [body, addressBudget] = await Promise.all([
      readCappedJson(request, MAX_BODY_BYTES),
      consumeBucket(
        bucketKey('forgot:ip', ip),
        ip === 'unknown' ? UNKNOWN_IP_LIMIT : IP_LIMIT,
        IP_WINDOW_SECS,
      ).catch(() => null),
    ]);

    if (addressBudget === null) return rateCounterUnavailable();
    if (!addressBudget.ok) return tooManyRequests(addressBudget);

    const email = (body as { email?: unknown })?.email;
    if (typeof email !== 'string' || email.trim().length === 0 || email.length > EMAIL_MAX_LENGTH) {
      return NextResponse.json(
        { success: false, message: 'A valid email address is required' },
        { status: 400 }
      );
    }

    // Bucket per requested mailbox: the one dimension a scripted client cannot
    // rotate without owning more addresses. Spent whether or not the account
    // exists, so probing it cannot cheapen an existence oracle either.
    const normalizedEmail = normalizeEmail(email);
    const mailboxBudget = await consumeBucket(
      bucketKey('forgot:email', normalizedEmail),
      EMAIL_LIMIT,
      EMAIL_WINDOW_SECS,
    ).catch(() => null);

    if (mailboxBudget === null) return rateCounterUnavailable();
    if (!mailboxBudget.ok) return tooManyRequests(mailboxBudget);

    const db = getDb();
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    // One audit row per request, found or not: identical work in both branches
    // keeps response timing flat, and a not-found row is as useful to an
    // operator investigating abuse as a found one. Always answer success —
    // the response must not distinguish existing accounts.
    await logAudit({
      user: user ? { id: user.id, name: user.name } : null,
      action: 'PASSWORD_RESET_REQUESTED',
      resourceType: 'User',
      resourceId: user?.id,
      details: { email: normalizedEmail, accountFound: Boolean(user) },
      req: { ip },
      status: 'PENDING',
    });

    return NextResponse.json({
      success: true,
      message: 'If an account matches this email, the recovery request has been recorded for the administrators.',
    });
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string; statusCode?: number; name?: string };
    console.error('[FORGOT PASSWORD ERROR]', {
      message: e?.message,
      code: e?.code,
      statusCode: e?.statusCode,
      name: e?.name,
    });

    // readCappedJson reports an oversized or non-JSON body as ValidationError.
    if (e?.name === 'ValidationError') {
      return NextResponse.json(
        { success: false, message: e.message ?? 'A valid email address is required' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Unable to process recovery request at this time.' },
      { status: 500 }
    );
  }
}
