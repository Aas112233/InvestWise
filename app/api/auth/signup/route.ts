import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, withDbRetry } from '@/db/index';
import { platformSettings, PLATFORM_SETTINGS_ID } from '@/db/schema/index';
import { bucketKey, consumeBucket, type BucketOutcome } from '@/lib/rate-limit';
import { getAbuseClientIp, readCappedJson } from '@/lib/request-meta';
import { logAudit } from '@/lib/utils/audit';
import {
  CURRENCIES,
  DATE_FORMATS,
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_FISCAL_YEAR_END,
  DEFAULT_FISCAL_YEAR_START,
  DEFAULT_SHARE_VALUE,
  FISCAL_MONTHS,
} from '@/lib/org-setup';
import { provisionTenant } from '@/lib/tenant-provision';
import { turnstileState, verifyTurnstileToken } from '@/lib/turnstile';
import { AppError, extractDbError } from '@/lib/utils/errors';

// Public signup is unauthenticated and creates real records, so every ceiling
// here is deliberately low: a human creates one organization, not ten.
const MAX_BODY_BYTES = 8 * 1024;
const IP_LIMIT = 5;
const IP_WINDOW_SECS = 15 * 60;
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_SECS = 30 * 60;
// Platform-wide circuit breaker: bounds total damage from rotating source
// addresses. Spent only AFTER a solved human proof, otherwise 41 empty POSTs
// per hour would saturate it and deny every honest signup for the price of curl.
const GLOBAL_LIMIT = 40;
const GLOBAL_WINDOW_SECS = 60 * 60;
// When no edge sets a client-address header (local `next start`, some staging
// setups) every anonymous visitor shares one bucket, so the shared budget has
// to be wider than the per-address one or a single noisy client locks everyone
// out. On Vercel the platform always fills one of these in, so this is the
// degraded path, not the normal one.
const UNKNOWN_IP_LIMIT = 20;
// Only used when platform_settings has no row yet (fresh or pre-0003 database).
const FALLBACK_TRIAL_DAYS = 14;

// Money arrives as a 2dp decimal string and stays a string; lib/org-setup.ts
// re-validates before anything is written.
const SHARE_VALUE_RE = /^\d{1,10}(\.\d{1,2})?$/;

/** Membership in an existing enumeration, reported as a field-level failure. */
function oneOf(values: readonly string[], field: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((v) => values.includes(v), `${field} is not supported`);
}

const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  email: z.string().trim().min(5).max(254).email(),
  password: z.string().min(8).max(200),
  confirmPassword: z.string().min(1).max(200),
  turnstileToken: z.string().max(2000).optional(),
  // Organization defaults captured during onboarding. Each is optional on the
  // wire and falls back to the platform default, so an older client still works.
  baseCurrency: oneOf(CURRENCIES.map((c) => c.value), 'baseCurrency').default(DEFAULT_CURRENCY),
  shareValue: z
    .string()
    .trim()
    .regex(SHARE_VALUE_RE, 'shareValue must be a positive amount with at most 2 decimals')
    .default(DEFAULT_SHARE_VALUE),
  dateFormat: oneOf(DATE_FORMATS, 'dateFormat').default(DEFAULT_DATE_FORMAT),
  fiscalYearStart: oneOf(FISCAL_MONTHS.map((m) => m.full), 'fiscalYearStart').default(DEFAULT_FISCAL_YEAR_START),
  fiscalYearEnd: oneOf(FISCAL_MONTHS.map((m) => m.full), 'fiscalYearEnd').default(DEFAULT_FISCAL_YEAR_END),
  // Optional extra funds named at signup. Bounded here for an early, field-level
  // 400; lib/org-setup.normalizeExtraFunds is the authoritative guard so any
  // caller (not just this route) cannot skip it. Money is never client-set.
  funds: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(120),
        type: z.enum(['DEPOSIT', 'PRIMARY', 'OTHER']),
      }),
    )
    .max(10)
    .optional(),
});

function tooManyRequests(outcome: BucketOutcome) {
  return NextResponse.json(
    { success: false, message: 'Too many sign-up attempts. Please try again later.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } },
  );
}

function counterUnavailable(error: unknown) {
  // A throttle that cannot be consulted must deny, not admit: failing open
  // would make the whole control a log line.
  console.error('[SIGNUP] rate counter unavailable, denying request:', (error as Error)?.message);
  return NextResponse.json(
    { success: false, message: 'Too many requests right now. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' },
    { status: 503 },
  );
}

/** The gate with the longest remaining wait, or null when all admit. */
function firstBlocked(outcomes: BucketOutcome[]): BucketOutcome | null {
  return outcomes.filter((o) => !o.ok).sort((a, b) => b.retryAfterSec - a.retryAfterSec)[0] ?? null;
}

/**
 * POST /api/auth/signup — public self-serve onboarding.
 *
 * Creates a new tenant, its first Admin, its settings row and a trial
 * subscription (lib/tenant-provision), then stops: no tokens and no session, so
 * the visitor authenticates through /login — the single audited entry path —
 * with the email they just registered.
 *
 * Controls, cheapest and least-bypassable first. Ordering matters: anything a
 * caller can reach must cost them budget, otherwise junk requests that fail
 * validation are free to send and the throttle only punishes honest clients —
 * while a budget that is spent *before* human proof can be drained by anyone
 * with a script, which is a denial of the feature itself.
 *
 *   1. operator kill switch (platform_settings.allow_public_registration) and
 *      the maintenance gate — enforced here, not merely hidden in the UI;
 *   2. per client IP counter, spent before the body is even read;
 *   3. hard body-size cap, then strict field validation;
 *   4. per-email counter — the one dimension a scripted client cannot rotate
 *      without owning another address;
 *   5. human proof (Cloudflare Turnstile), fail-closed in production and
 *      allergic to Cloudflare's always-pass test vectors;
 *   6. the platform-wide ceiling, paid only by callers who solved the widget;
 *   7. provisioning, which re-validates policy and clamps every stored field.
 */
export async function POST(request: NextRequest) {
  const ip = getAbuseClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'Unknown';

  try {
    // Fail closed before doing any work: an endpoint that cannot prove the
    // caller is human must not create tenants in production.
    const captcha = turnstileState();
    if (captcha.mode === 'unavailable') {
      console.error('[SIGNUP] refusing request, bot protection unavailable:', captcha.reason);
      return NextResponse.json(
        { success: false, message: 'Sign-up is temporarily unavailable. Please try again later.', code: 'BOT_PROTECTION_UNAVAILABLE' },
        { status: 503 },
      );
    }

    const db = getDb();
    // A missing platform_settings table (migrations 0003/0004 not applied) or a
    // dead pooler connection surfaces here as a bare throw with no status, which
    // the generic handler would report as an unexplained 500. Name the real
    // failure instead: this endpoint is unavailable until the schema is.
    let settingsRows;
    try {
      settingsRows = await withDbRetry(() =>
        db
          .select({
            allowPublicRegistration: platformSettings.allowPublicRegistration,
            globalMaintenanceMode: platformSettings.globalMaintenanceMode,
            maintenanceMessage: platformSettings.maintenanceMessage,
            defaultTrialDays: platformSettings.defaultTrialDays,
            defaultCurrency: platformSettings.defaultCurrency,
          })
          .from(platformSettings)
          .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
          .limit(1),
      );
    } catch (error) {
      console.error(
        '[SIGNUP] platform_settings unreadable — is db/migrations/0003_tenant_module_entitlements.sql applied?',
        (error as Error)?.message?.split('\n')[0],
      );
      return NextResponse.json(
        { success: false, message: 'Sign-up is temporarily unavailable. Please try again later.', code: 'PLATFORM_SETTINGS_UNAVAILABLE' },
        { status: 503 },
      );
    }

    const [settings] = settingsRows;

    if (!settings) {
      // Fail closed: no platform_settings row means nothing was ever decided,
      // and "allowed by absence" is not a decision. Visiting /admin/settings
      // self-heals the row; this logs loudly until then.
      console.error('[SIGNUP] refusing request: platform_settings row is missing');
      return NextResponse.json(
        { success: false, message: 'Sign-up is temporarily unavailable. Please try again later.', code: 'PLATFORM_SETTINGS_MISSING' },
        { status: 503 },
      );
    }

    if (!settings.allowPublicRegistration) {
      return NextResponse.json(
        { success: false, message: 'Public registration is currently disabled.', code: 'REGISTRATION_CLOSED' },
        { status: 403 },
      );
    }

    // Do not mint new tenants while the platform is locked for maintenance.
    if (settings?.globalMaintenanceMode) {
      return NextResponse.json(
        {
          success: false,
          message: settings.maintenanceMessage || 'The platform is under maintenance. Please try again later.',
          code: 'SERVICE_UNAVAILABLE',
        },
        { status: 503 },
      );
    }

    // Only the IP counter is spent here. It is cheap for the caller to reset by
    // rotating a header on any deployment whose edge does not overwrite it, so
    // it is a nuisance gate, not the last line — the CAPTCHA and email budget
    // are what a serious attacker has to pay.
    let coarse: BucketOutcome[];
    try {
      coarse = await Promise.all([
        consumeBucket(bucketKey('signup:ip', ip), ip === 'unknown' ? UNKNOWN_IP_LIMIT : IP_LIMIT, IP_WINDOW_SECS),
      ]);
    } catch (error) {
      return counterUnavailable(error);
    }

    const coarseBlocked = firstBlocked(coarse);
    if (coarseBlocked) {
      console.warn('[SIGNUP] rate limited before body parse');
      return tooManyRequests(coarseBlocked);
    }

    // Read the body through the shared cap: `content-length` is a header any
    // client can omit or lie about, so the cap is applied to the bytes
    // actually read (lib/request-meta.ts).
    const raw = await readCappedJson(request, MAX_BODY_BYTES);

    const parsed = signupSchema.safeParse(raw);
    if (!parsed.success) {
      // Field paths only: Zod issue messages echo the submitted value, and one
      // of these fields is a password.
      console.warn('[SIGNUP] rejected invalid payload at', parsed.error.issues.map((i) => i.path.join('.')).join(','));
      return NextResponse.json(
        { success: false, message: 'Check the form and try again.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const {
      organizationName,
      adminName,
      email,
      password,
      confirmPassword,
      turnstileToken,
      baseCurrency,
      shareValue,
      dateFormat,
      fiscalYearStart,
      fiscalYearEnd,
      funds,
    } = parsed.data;

    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: 'Passwords do not match', code: 'PASSWORD_MISMATCH' },
        { status: 400 },
      );
    }

    let perEmail: BucketOutcome;
    try {
      perEmail = await consumeBucket(bucketKey('signup:email', email), EMAIL_LIMIT, EMAIL_WINDOW_SECS);
    } catch (error) {
      return counterUnavailable(error);
    }
    if (!perEmail.ok) {
      return tooManyRequests(perEmail);
    }

    // Absent token is answered locally so junk costs no outbound call; the
    // redemption itself is still verified server-side below.
    if (captcha.mode === 'required') {
      if (typeof turnstileToken !== 'string') {
        return NextResponse.json(
          { success: false, message: 'Bot verification is required.', code: 'CAPTCHA_MISSING' },
          { status: 403 },
        );
      }
      const verdict = await verifyTurnstileToken(turnstileToken, ip);
      if (!verdict.ok) {
        return NextResponse.json({ success: false, message: verdict.message, code: verdict.code }, { status: 403 });
      }
    }

    // Paid only by a caller who solved the widget, so draining the platform
    // ceiling costs a real CAPTCHA per attempt instead of one empty POST.
    let global: BucketOutcome;
    try {
      global = await consumeBucket('signup:global', GLOBAL_LIMIT, GLOBAL_WINDOW_SECS);
    } catch (error) {
      return counterUnavailable(error);
    }
    if (!global.ok) {
      console.error('[SIGNUP] platform ceiling reached; rejecting signup', {
        count: global.count,
        limit: global.limit,
        retryAfterSec: global.retryAfterSec,
      });
      return tooManyRequests(global);
    }

    const result = await provisionTenant({
      organizationName,
      adminName,
      email,
      password,
      // Financial configuration for the tenant's system_settings row. The
      // currency shown here wins over platform_settings.default_currency, which
      // is only the fallback for clients that do not ask.
      financial: { baseCurrency, shareValue, dateFormat, fiscalYearStart, fiscalYearEnd },
      // Extra funds the owner named at signup, added on top of the standard
      // seeded set. Validated and account-numbered server-side in provisioning.
      funds,
      trialDays: settings.defaultTrialDays ?? FALLBACK_TRIAL_DAYS,
      // Self-serve lands on the standard plan, and a missing plan row must not
      // block someone from starting a trial.
      plan: 'standard',
      onUnknownPlan: 'fallback',
      actor: null,
      reason: 'Created via public self-serve signup',
    });

    await logAudit({
      tenantId: result.tenantId,
      action: 'TENANT_SIGNUP',
      resourceType: 'Tenant',
      resourceId: result.tenantId,
      details: { slug: result.slug, email: result.email },
      // The abuse-control address, not the first XFF entry: an audit row that
      // stores attacker-chosen text is forensic pollution, which is its only
      // purpose.
      req: { ip, headers: { 'user-agent': userAgent } },
      status: 'SUCCESS',
    });

    return NextResponse.json(
      {
        success: true,
        data: { tenantId: result.tenantId, slug: result.slug, email: result.email },
        message: 'Organization created',
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string; statusCode?: number; name?: string };
    // AppError messages are policy text and safe to show; a raw error dump would
    // carry user input, so only the shape is logged. The underlying Postgres
    // SQLSTATE and message live on Drizzle's nested cause, so unwrap them —
    // otherwise a real DB failure is logged as an opaque "Failed query".
    const db = extractDbError(error);
    console.error('[SIGNUP ERROR]', {
      message: e?.message,
      code: e?.code,
      statusCode: e?.statusCode,
      name: e?.name,
      pgCode: db.code,
      pgMessage: db.message,
    });

    if (error instanceof AppError) {
      // A conflict on this path means the email is already registered. Naming
      // that aloud turns a public form into a customer directory for a
      // financial-records system, so the wording stays ambiguous. The residual
      // oracle — success versus conflict for a novel address — is inherent to
      // rejecting duplicates without an email-verification step, and is priced
      // at one solved CAPTCHA per probe.
      if (error.statusCode === 409) {
        return NextResponse.json(
          {
            success: false,
            message: 'We could not create the organization with those details.',
            code: 'SIGNUP_CONFLICT',
          },
          { status: 409 },
        );
      }
      const headers =
        error.statusCode === 423 ? { headers: { 'Retry-After': String(IP_WINDOW_SECS) } } : undefined;
      return NextResponse.json(
        { success: false, message: e.message ?? 'Sign-up failed', code: e.code },
        { status: error.statusCode, ...headers },
      );
    }

    return NextResponse.json(
      { success: false, message: 'Could not create your organization', code: 'SIGNUP_FAILED' },
      { status: 500 },
    );
  }
}
