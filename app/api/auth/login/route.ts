import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users, sessions, blacklistedTokens, loginAttempts } from '@/db/schema/index';
import { eq, and, gte, desc, count, ne } from 'drizzle-orm';
import { generateTokenPair, verifyToken, blacklistToken } from '@/lib/utils/jwt';
import { hashPassword, comparePassword, validatePasswordStrength } from '@/lib/utils/password';
import { setAuthCookies, clearAuthCookies, COOKIE_NAMES } from '@/lib/utils/cookies';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { normalizeRole } from '@/lib/roles';
import { AuthError, NotFoundError, ConflictError, LockedError, AppError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

// Constants
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_HISTORY = 50;

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
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0';
}

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, location } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    const loc = location || {};
    const country = loc.country || null;
    const city = loc.city || null;
    const region = loc.region || null;
    const now = new Date();
    const normalizedEmail = normalizeEmail(email);

    // Lockout check
    const lockoutSince = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
    const db = getDb();
    const [failedCountResult] = await db
      .select({ count: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, normalizedEmail),
          eq(loginAttempts.success, false),
          gte(loginAttempts.timestamp, lockoutSince),
        ),
      );

    if ((failedCountResult?.count ?? 0) >= LOCKOUT_THRESHOLD) {
      await db.insert(loginAttempts).values({
        email: normalizedEmail,
        ipAddress: ip,
        success: false,
        failureReason: 'account_locked',
        userAgent,
        locationCountry: country,
        locationCity: city,
      });

      throw new LockedError('Account temporarily locked due to too many failed attempts. Please try again later.');
    }

    // Find user with password
    const [userRow] = await db
      .select({
        ...USER_SELECT,
        passwordHash: users.password,
        tenantId: users.tenantId,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
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

    // Successful login
    await db.insert(loginAttempts).values({
      email: normalizedEmail,
      ipAddress: ip,
      success: true,
      userAgent,
      locationCountry: country,
      locationCity: city,
      userId: userRow.id,
    });

    await db
      .update(users)
      .set({ lastLogin: now, updatedAt: now })
      .where(eq(users.id, userRow.id));

    const user = toUserResponse(userRow);
    const tokens = generateTokenPair(userRow.id, {
      role: user.role,
      email: user.email,
      tenantId: userRow.tenantId ?? null,
      subscriptionBlocked: await getTenantSubscriptionBlocked(userRow.tenantId ?? null),
    });

    // Create session
    const sessionId = crypto.randomUUID();
    const { deviceInfo, osInfo, browserInfo } = parseUserAgent(userAgent);
    await db.insert(sessions).values({
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
    });

    await logAudit({
      action: 'LOGIN',
      resourceType: 'User',
      resourceId: userRow.id,
      details: { email: normalizedEmail, ip },
      status: 'SUCCESS',
    });

    const response = NextResponse.json({
      ...user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

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