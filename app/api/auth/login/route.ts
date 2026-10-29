import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, sessions, blacklistedTokens, loginAttempts } from '@/db/schema/index';
// `count` and `gte` were dropped with the COUNT-based lockout they served; the
// lock is read from account_locks now (lib/account-lock.ts).
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { generateTokenPair, verifyToken, blacklistToken } from '@/lib/utils/jwt';
import { hashPassword, comparePassword, validatePasswordStrength } from '@/lib/utils/password';
import { setAuthCookies, clearAuthCookies, COOKIE_NAMES } from '@/lib/utils/cookies';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { normalizeRole } from '@/lib/roles';
import { AuthError, NotFoundError, ConflictError, LockedError, AppError } from '@/lib/utils/errors';
import { bucketKey, consumeBucket, type BucketOutcome } from '@/lib/rate-limit';
import { clampText, getAbuseClientIp, readCappedJson } from '@/lib/request-meta';
import { readAccountLock, recordAuthFailure, clearAccountLock, type AccountLockState } from '@/lib/account-lock';
import crypto from 'node:crypto';

// Constants
// Lockout threshold and window live in lib/account-lock.ts, next to the state
// they govern, because the reset/clear rules have to stay in step with them.
const MAX_LOGIN_HISTORY = 50;
// Public, unauthenticated endpoint: bound the platform-side cost (one Postgres
// round trip + a bcrypt compare per request) that credential stuffing across
// many mailboxes would otherwise multiply freely. Keyed per client address,
// spent on every request, and deliberately wider than the per-email lockout so
// a small office behind one NAT address is never throttled by its own traffic.
const MAX_BODY_BYTES = 4 * 1024;
const LOGIN_IP_LIMIT = 30;
const LOGIN_IP_WINDOW_SECS = 15 * 60;
// Without an edge-stamped address every anonymous visitor shares one bucket.
const LOGIN_UNKNOWN_IP_LIMIT = 60;

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  permissions: users.permissions,
  avatar: users.avatar,
  memberId: users.memberId,
  lastLogin: users.lastLogin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

function getDefaultPermissions(role: string): Record<string, string> {
  const perms: Record<string, string> = {};
  if (role === 'Admin') {
    for (const screen of ALL_SCREENS) perms[screen] = 'WRITE';
  } else if (role === 'Manager') {
    for (const screen of ALL_SCREENS) perms[screen] = 'READ';
  }
  return perms;
}

function toUserResponse(row: Record<string, unknown>) {
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};

  const role = normalizeRole(row.role);

  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role,
    status: (row.status as string) ?? 'active',
    permissions,
    avatar: (row.avatar as string) ?? null,
    memberId: (row.memberId as string) ?? null,
    lastLogin: row.lastLogin instanceof Date ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
  };
}

function parseUserAgent(ua: string) {
  const deviceInfo = ua.includes('Mobile')
    ? 'Mobile'
    : ua.includes('Tablet')
      ? 'Tablet'
      : 'Desktop';

  let osInfo = 'Unknown';
  if (ua.includes('Windows')) osInfo = 'Windows';
  else if (ua.includes('Mac')) osInfo = 'macOS';
  else if (ua.includes('Linux')) osInfo = 'Linux';
  else if (ua.includes('Android')) osInfo = 'Android';
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) osInfo = 'iOS';

  let browserInfo = 'Unknown';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browserInfo = 'Chrome';
  else if (ua.includes('Firefox')) browserInfo = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browserInfo = 'Safari';
  else if (ua.includes('Edg')) browserInfo = 'Edge';

  return { deviceInfo, osInfo, browserInfo };
}

function getClientIp(request: NextRequest): string {
  return getAbuseClientIp(request);
}

/**
 * Constant-work guard against timing-based account enumeration.
 *
 * A request for an unknown email currently returns without a bcrypt compare,
 * so response time alone distinguishes "no such user" from "wrong password".
 * Running one compare against a throwaway hash keeps both branches at the
 * same cost. The hash is derived once per process and never matches a real
 * credential.
 */
let DUMMY_HASH: string | null = null;
async function equalizePasswordTiming(password: string): Promise<void> {
  if (!DUMMY_HASH) {
    DUMMY_HASH = await hashPassword(crypto.randomUUID());
  }
  await comparePassword(password, DUMMY_HASH);
}

function tooManyRequests(outcome: BucketOutcome) {
  return NextResponse.json(
    { success: false, message: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSec) } },
  );
}

/**
 * 423 with a machine-readable unlock time.
 *
 * The per-IP throttle already sent Retry-After; the account lockout never did,
 * so a client could only ever repeat "try again later" without saying when.
 * Returned rather than thrown so the header can be attached without changing
 * LockedError, which six other handlers use for unrelated lock semantics
 * (suspended, inactive, closed fiscal period, locked share value).
 */
function accountLockedResponse(state: AccountLockState) {
  const minutes = Math.max(1, Math.ceil(state.retryAfterSec / 60));
  return NextResponse.json(
    {
      success: false,
      message: `Account temporarily locked due to too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      code: 'LOCKED',
      lockedUntil: state.lockedUntil?.toISOString() ?? null,
      retryAfterSec: state.retryAfterSec,
    },
    {
      status: 423,
      headers: { 'Retry-After': String(state.retryAfterSec) },
    },
  );
}

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    // The address budget is spent before any other work. Reading the capped
    // body runs alongside it — the two are independent, so the throttle adds
    // no sequential latency — and both happen before any credential logic, so
    // junk requests pay their address budget and nothing else.
    const ip = getClientIp(request);
    const [body, addressBudget] = await Promise.all([
      readCappedJson(request, MAX_BODY_BYTES),
      consumeBucket(
        bucketKey('login:ip', ip),
        ip === 'unknown' ? LOGIN_UNKNOWN_IP_LIMIT : LOGIN_IP_LIMIT,
        LOGIN_IP_WINDOW_SECS,
      ).catch(() => null),
    ]);

    // A throttle that cannot be consulted must deny, not admit: failing open
    // would make the whole control a log line.
    if (addressBudget === null) {
      console.error('[LOGIN] rate counter unavailable, denying request');
      return NextResponse.json(
        { success: false, message: 'Too many requests right now. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' },
        { status: 503 },
      );
    }
    if (!addressBudget.ok) {
      return tooManyRequests(addressBudget);
    }

    // A JSON body of `null` or a scalar must fail validation, not throw.
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    const { email, password, location } = body as { email?: unknown; password?: unknown; location?: unknown };

    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    // Client-controlled free text clamped to the session/attempt column widths
    // (varchar(100)); a bloated or non-string value degrades to null instead of
    // erroring the insert or bloating the forensics tables.
    const country = clampText((location as { country?: unknown } | null)?.country, 100);
    const city = clampText((location as { city?: unknown } | null)?.city, 100);
    const region = clampText((location as { region?: unknown } | null)?.region, 100);
    const now = new Date();
    const normalizedEmail = normalizeEmail(email);

    // ── Account lockout ───────────────────────────────────────────────────
    // A read of stored state. It writes nothing, and that is the point: the
    // previous version counted `login_attempts` rows and then INSERTED another
    // failed row for the rejection, so each retry while locked moved the unlock
    // time a full 15 minutes further out and the lockout never expired for
    // anyone who kept following its own advice.
    //
    // Degrades OPEN if the state cannot be read, which is a deliberate
    // difference from the per-IP throttle above (that one answers 503). The
    // difference is what each protects: the throttle bounds flooding and must
    // not lapse, whereas the lockout is a secondary control sitting behind an
    // intact bcrypt verification — refusing to read its table would turn a
    // partial outage into nobody being able to sign in anywhere.
    const db = getDb();
    let lock: AccountLockState;
    try {
      lock = await readAccountLock(normalizedEmail);
    } catch (lockReadError) {
      // Logged and deliberately non-fatal — see the degrade-open note above.
      console.error('[LOGIN] account lock state unreadable, allowing credential check to proceed', lockReadError);
      lock = { locked: false, lockedUntil: null, failedAttempts: 0, retryAfterSec: 0 };
    }

    if (lock.locked) {
      // Forensic record only. Nothing reads login_attempts for authorization
      // any more, so noting the rejection cannot extend it.
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'account_locked',
        userAgent,
        locationCountry: country,
        locationCity: city,
      });

      return accountLockedResponse(lock);
    }

    // Find user with password.
    //
    // Email is now unique PER TENANT (db/migrations/0009), so the same address
    // may legitimately resolve to more than one row across tenants. Platform
    // operators (tenant_id IS NULL) are matched first so the platform login
    // always wins over a tenant that happens to reuse the address; within
    // tenants the oldest account is the stable choice (email reuse across
    // tenants is rare). Password verification below then disambiguates.
    const [userRow] = await db
      .select({
        ...USER_SELECT,
        passwordHash: users.password,
        tenantId: users.tenantId,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .orderBy(sql`${users.tenantId} IS NOT NULL`, users.createdAt)
      .limit(1);

    if (!userRow) {
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'invalid_email',
        userAgent,
        locationCountry: country,
        locationCity: city,
      });
      // Same number of bcrypt compares as the wrong-password branch, so
      // response time cannot reveal whether the address exists.
      await equalizePasswordTiming(password);
      // Counted exactly like a wrong password. An address that matches no user
      // is not an unlimited guessing target, and the client sees the same
      // response either way, so the counter must advance the same way too.
      const afterUnknown = await recordAuthFailure(normalizedEmail);
      if (afterUnknown.locked) return accountLockedResponse(afterUnknown);
      throw new AuthError('Invalid email or password');
    }

    // Verify password
    const passwordOk = await comparePassword(password, userRow.passwordHash);
    if (!passwordOk) {
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'invalid_password',
        userAgent,
        locationCountry: country,
        locationCity: city,
        userId: userRow.id,
      });
      // If this is the strike that locks the address, say so now rather than
      // returning a plain 401 and letting the user discover the lock on their
      // next attempt.
      const afterFailure = await recordAuthFailure(normalizedEmail);
      if (afterFailure.locked) return accountLockedResponse(afterFailure);
      throw new AuthError('Invalid email or password');
    }

    // Status check
    if (userRow.status === 'suspended') {
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'account_suspended',
        userAgent,
        locationCountry: country,
        locationCity: city,
        userId: userRow.id,
      });
      throw new LockedError('Account is suspended. Please contact an administrator.');
    }

    if (userRow.status === 'inactive') {
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'account_inactive',
        userAgent,
        locationCountry: country,
        locationCity: city,
        userId: userRow.id,
      });
      throw new LockedError('Account is inactive. Please contact an administrator.');
    }

    // Successful login — all independent DB operations (attempt log, lastLogin
    // stamp, subscription gate, session row, audit entry, lock reset) run
    // concurrently as one round-trip group instead of sequentially; only token
    // signing waits, because the subscription verdict is baked into the
    // access-token claims.
    //
    // Clearing the lock here is what the old implementation never did: it wrote
    // a `success = true` row but left the failures in place, so four historical
    // typos kept an authenticated user permanently one mistake from locked.
    const user = toUserResponse(userRow);
    const sessionId = crypto.randomUUID();
    const { deviceInfo, osInfo, browserInfo } = parseUserAgent(userAgent);

    const [, , subscriptionBlocked] = await Promise.all([
      db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: true,
        userAgent,
        locationCountry: country,
        locationCity: city,
        userId: userRow.id,
      }),
      db
        .update(users)
        .set({ lastLogin: now, updatedAt: now })
        .where(eq(users.id, userRow.id)),
      getTenantSubscriptionBlocked(userRow.tenantId ?? null),
      db.insert(sessions).values({
        userId: userRow.id,
        sessionId,
        ipAddress: ip,
        userAgent,
        locationCountry: country || 'Unknown',
        locationCity: city || 'Unknown',
        locationRegion: region || 'Unknown',
        loginTime: now,
        lastActivity: now,
        isActive: true,
        isExpired: false,
        deviceInfo,
        osInfo,
        browserInfo,
      }),
      logAudit({
        action: 'LOGIN',
        resourceType: 'User',
        resourceId: userRow.id,
        details: { email: normalizedEmail, ip },
        status: 'SUCCESS',
      }),
      clearAccountLock(normalizedEmail),
    ]);

    const tokens = generateTokenPair(userRow.id, {
      role: user.role,
      email: user.email,
      tenantId: userRow.tenantId ?? null,
      subscriptionBlocked,
      sessionId,
    });

    // Tokens travel ONLY as HttpOnly cookies (setAuthCookies below). The body
    // is profile-only: a JWT in the JSON response is readable by any injected
    // script and lands in logs/proxies, defeating the cookie hardening.
    const response = NextResponse.json({ ...user });

    setAuthCookies(response.cookies, tokens.accessToken, tokens.refreshToken);

    return response;
  } catch (error: any) {
    console.error('[LOGIN ERROR]', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      name: error.name,
    });

    if (error instanceof AppError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Login failed', code: 'LOGIN_FAILED' },
      { status: 500 }
    );
  }
}