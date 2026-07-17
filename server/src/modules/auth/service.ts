import { eq, and, desc, gte, ne, count } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getDb } from '../../config/database.js';
import {
  users,
  sessions,
  blacklistedTokens,
  loginAttempts,
} from '../../db/schema/index.js';
import { generateTokenPair, verifyToken } from '../../lib/jwt.js';
import { hashPassword, comparePassword } from '../../lib/password.js';
import { logAudit } from '../../lib/audit.js';
import { AppError, AuthError, NotFoundError, ConflictError, LockedError } from '../../shared/errors.js';
import { normalizeEmail } from '../../shared/utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Location {
  country?: string;
  city?: string;
  region?: string;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  avatar: string | null;
  memberId: string | null;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  user: UserResponse;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
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

function toUserResponse(row: Record<string, unknown>): UserResponse {
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: (row.role as string) ?? 'Member',
    status: (row.status as string) ?? 'active',
    permissions,
    avatar: (row.avatar as string) ?? null,
    memberId: (row.memberId as string) ?? null,
    lastLogin: row.lastLogin instanceof Date ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
  };
}

function getTokenExpiry(token: string): Date {
  try {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    if (decoded?.exp) {
      return new Date(decoded.exp * 1000);
    }
  } catch {
    // Fall through to default
  }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function parseUserAgent(ua: string): {
  deviceInfo: string;
  osInfo: string;
  browserInfo: string;
} {
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

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  ip: string,
  userAgent: string,
  location?: Location,
): Promise<LoginResult> {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const loc = location || {};
  const country = loc.country || null;
  const city = loc.city || null;
  const region = loc.region || null;
  const now = new Date();

  // --- Lockout check -------------------------------------------------------
  const lockoutSince = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
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

  if (failedCountResult.count >= LOCKOUT_THRESHOLD) {
    // Record the blocked attempt so the lockout window resets on each hit
    await db.insert(loginAttempts).values({
      email: normalizedEmail,
      ipAddress: ip,
      success: false,
      failureReason: 'account_locked',
      userAgent,
      locationCountry: country,
      locationCity: city,
    });

    throw new LockedError(
      'Account temporarily locked due to too many failed attempts. Please try again later.',
    );
  }

  // --- Find user -----------------------------------------------------------
  const [userRow] = await db
    .select(USER_SELECT)
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

  // --- Verify password (need full row for the hash) ------------------------
  const [userWithPw] = await db
    .select({ password: users.password })
    .from(users)
    .where(eq(users.id, userRow.id))
    .limit(1);

  const passwordOk = await comparePassword(password, userWithPw.password);
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

  // --- Status check --------------------------------------------------------
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
      failureReason: 'account_suspended',
      userAgent,
      locationCountry: country,
      locationCity: city,
      userId: userRow.id,
    });
    throw new LockedError('Account is inactive. Please contact an administrator.');
  }

  // --- Successful login ----------------------------------------------------
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

  const tokens = generateTokenPair(userRow.id);

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

  return {
    user: toUserResponse(userRow),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// Register (admin only)
// ---------------------------------------------------------------------------

export async function registerUser(
  adminUser: { id: string; name: string },
  userData: {
    name: string;
    email: string;
    password: string;
    role?: string;
    memberId?: string;
    permissions?: Record<string, string>;
  },
): Promise<UserResponse> {
  const db = getDb();
  const email = normalizeEmail(userData.email);

  // Check for existing user
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  const hashed = await hashPassword(userData.password);

  const [created] = await db
    .insert(users)
    .values({
      name: userData.name,
      email,
      password: hashed,
      role: userData.role || 'Member',
      memberId: userData.memberId || null,
      permissions: (userData.permissions && Object.keys(userData.permissions).length > 0
        ? userData.permissions
        : getDefaultPermissions(userData.role || 'Member')) as Record<string, string>,
    })
    .returning(USER_SELECT);

  await logAudit({
    action: 'CREATE_USER',
    resourceType: 'User',
    resourceId: created.id,
    details: { createdBy: adminUser.id, email, role: userData.role },
    status: 'SUCCESS',
  });

  return toUserResponse(created);
}

// ---------------------------------------------------------------------------
// Profile / Users
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<UserResponse> {
  const db = getDb();
  const [user] = await db
    .select(USER_SELECT)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new NotFoundError('User');
  }

  return toUserResponse(user);
}

export async function getAllUsers(): Promise<UserResponse[]> {
  const db = getDb();
  const rows = await db
    .select(USER_SELECT)
    .from(users)
    .orderBy(desc(users.createdAt));

  return rows.map(toUserResponse);
}

// ---------------------------------------------------------------------------
// Update user (admin)
// ---------------------------------------------------------------------------

export async function updateUser(
  adminUser: { id: string; name: string },
  userId: string,
  updates: {
    name?: string;
    email?: string;
    role?: string;
    status?: string;
    permissions?: Record<string, string>;
    memberId?: string;
  },
): Promise<UserResponse> {
  const db = getDb();

  const [target] = await db
    .select(USER_SELECT)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError('User');
  }

  // If email is changing, check uniqueness
  if (updates.email !== undefined && updates.email !== target.email) {
    const [duplicate] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, updates.email))
      .limit(1);

    if (duplicate) {
      throw new ConflictError('Email is already in use by another user');
    }
  }

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) updateValues.name = updates.name;
  if (updates.email !== undefined) updateValues.email = updates.email;
  if (updates.role !== undefined) updateValues.role = updates.role;
  if (updates.status !== undefined) updateValues.status = updates.status;
  if (updates.permissions !== undefined) updateValues.permissions = updates.permissions;
  if (updates.memberId !== undefined) updateValues.memberId = updates.memberId;

  await db
    .update(users)
    .set(updateValues)
    .where(eq(users.id, userId));

  // Fetch updated user
  const [updated] = await db
    .select(USER_SELECT)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await logAudit({
    action: 'UPDATE_USER',
    resourceType: 'User',
    resourceId: userId,
    details: { updatedBy: adminUser.id, changes: Object.keys(updates) },
    status: 'SUCCESS',
  });

  return toUserResponse(updated);
}

// ---------------------------------------------------------------------------
// Delete user (admin)
// ---------------------------------------------------------------------------

export async function deleteUser(
  adminUser: { id: string; name: string },
  userId: string,
): Promise<void> {
  if (adminUser.id === userId) {
    throw new AppError('You cannot delete your own account', 400, 'SELF_DELETE');
  }

  const db = getDb();

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError('User');
  }

  // Prevent deleting the last active admin
  if (target.role === 'Admin') {
    const [remaining] = await db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'Admin'),
          eq(users.status, 'active'),
          ne(users.id, userId),
        ),
      );

    if (remaining.count === 0) {
      throw new AppError(
        'Cannot delete the last active admin account',
        400,
        'LAST_ADMIN',
      );
    }
  }

  await db.delete(users).where(eq(users.id, userId));

  await logAudit({
    action: 'DELETE_USER',
    resourceType: 'User',
    resourceId: userId,
    details: { deletedBy: adminUser.id },
    status: 'SUCCESS',
  });
}

// ---------------------------------------------------------------------------
// Admin: reset any user's password
// ---------------------------------------------------------------------------

export async function updateUserPassword(
  adminUser: { id: string; name: string },
  userId: string,
  newPassword: string,
): Promise<void> {
  const db = getDb();

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) {
    throw new NotFoundError('User');
  }

  const hashed = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ password: hashed, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await logAudit({
    action: 'UPDATE_USER_PASSWORD',
    resourceType: 'User',
    resourceId: userId,
    details: { resetBy: adminUser.id },
    status: 'SUCCESS',
  });
}

// ---------------------------------------------------------------------------
// User changes their own password
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const db = getDb();

  const [userWithPw] = await db
    .select({ password: users.password })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userWithPw) {
    throw new NotFoundError('User');
  }

  const valid = await comparePassword(currentPassword, userWithPw.password);
  if (!valid) {
    throw new AuthError('Current password is incorrect', 'INVALID_PASSWORD');
  }

  const hashed = await hashPassword(newPassword);

  await db
    .update(users)
    .set({ password: hashed, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  const db = getDb();

  // Verify JWT
  const decoded = verifyToken(refreshToken, 'refresh');

  // Check blacklist
  const [blacklisted] = await db
    .select({ id: blacklistedTokens.id })
    .from(blacklistedTokens)
    .where(
      and(
        eq(blacklistedTokens.token, refreshToken),
        gte(blacklistedTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (blacklisted) {
    throw new AuthError('Refresh token has been revoked', 'TOKEN_REVOKED');
  }

  // Verify user still exists and is active
  const [user] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, decoded.id))
    .limit(1);

  if (!user) {
    throw new AuthError('User not found', 'USER_NOT_FOUND');
  }

  if (user.status === 'suspended' || user.status === 'inactive') {
    throw new AuthError(
      `Account is ${user.status}`,
      user.status === 'suspended' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_INACTIVE',
    );
  }

  // Rotate: blacklist old token, generate new pair
  const expiry = getTokenExpiry(refreshToken);
  try {
    await db.insert(blacklistedTokens).values({
      token: refreshToken,
      type: 'refresh',
      userId: decoded.id,
      expiresAt: expiry,
      reason: 'rotation',
    });
  } catch (insertError) {
    const pgErr = insertError as { code?: string; detail?: string; message?: string; constraint?: string; column?: string };
    console.error('[blacklist INSERT failed]', {
      code: pgErr.code,
      detail: pgErr.detail,
      constraint: pgErr.constraint,
      column: pgErr.column,
      message: pgErr.message,
    });
    throw insertError;
  }

  const tokens = generateTokenPair(decoded.id);

  return tokens;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutUser(
  userId: string,
  refreshToken?: string,
  sessionId?: string,
): Promise<void> {
  const db = getDb();

  // Blacklist the refresh token
  if (refreshToken) {
    try {
      const expiry = getTokenExpiry(refreshToken);
      await db.insert(blacklistedTokens).values({
        token: refreshToken,
        type: 'refresh',
        userId,
        expiresAt: expiry,
        reason: 'logout',
      });
    } catch {
      // If the token is malformed we still proceed to end the session
    }
  }

  // End specific session if sessionId provided
  if (sessionId) {
    await db
      .update(sessions)
      .set({
        isActive: false,
        isExpired: true,
        logoutTime: new Date(),
      })
      .where(
        and(eq(sessions.sessionId, sessionId), eq(sessions.userId, userId)),
      );
  }

  await logAudit({
    action: 'LOGOUT',
    resourceType: 'User',
    resourceId: userId,
    details: { sessionEnded: Boolean(sessionId) },
    status: 'SUCCESS',
  });
}

// ---------------------------------------------------------------------------
// Logout all devices
// ---------------------------------------------------------------------------

export async function logoutAllDevices(userId: string): Promise<void> {
  const db = getDb();

  // End all active sessions
  await db
    .update(sessions)
    .set({
      isActive: false,
      isExpired: true,
      logoutTime: new Date(),
    })
    .where(
      and(eq(sessions.userId, userId), eq(sessions.isActive, true)),
    );

  await logAudit({
    action: 'LOGOUT_ALL_DEVICES',
    resourceType: 'User',
    resourceId: userId,
    status: 'SUCCESS',
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSessions(userId: string) {
  const db = getDb();

  const rows = await db
    .select({
      id: sessions.id,
      sessionId: sessions.sessionId,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      locationCountry: sessions.locationCountry,
      locationCity: sessions.locationCity,
      locationRegion: sessions.locationRegion,
      deviceInfo: sessions.deviceInfo,
      osInfo: sessions.osInfo,
      browserInfo: sessions.browserInfo,
      loginTime: sessions.loginTime,
      lastActivity: sessions.lastActivity,
      isActive: sessions.isActive,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(eq(sessions.userId, userId), eq(sessions.isActive, true)),
    )
    .orderBy(desc(sessions.lastActivity));

  return rows.map((s) => ({
    ...s,
    loginTime: s.loginTime?.toISOString() ?? null,
    lastActivity: s.lastActivity?.toISOString() ?? null,
    createdAt: s.createdAt?.toISOString() ?? null,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const db = getDb();

  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionId, sessionId),
        eq(sessions.userId, userId),
        eq(sessions.isActive, true),
      ),
    )
    .limit(1);

  if (!session) {
    throw new NotFoundError('Session');
  }

  await db
    .update(sessions)
    .set({
      isActive: false,
      isExpired: true,
      logoutTime: new Date(),
    })
    .where(eq(sessions.id, session.id));
}

// ---------------------------------------------------------------------------
// Login history
// ---------------------------------------------------------------------------

export async function getLoginHistory(userId: string) {
  const db = getDb();

  // Get user email first
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new NotFoundError('User');
  }

  const rows = await db
    .select({
      id: loginAttempts.id,
      email: loginAttempts.email,
      ipAddress: loginAttempts.ipAddress,
      success: loginAttempts.success,
      failureReason: loginAttempts.failureReason,
      timestamp: loginAttempts.timestamp,
      userAgent: loginAttempts.userAgent,
      locationCountry: loginAttempts.locationCountry,
      locationCity: loginAttempts.locationCity,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.email, user.email))
    .orderBy(desc(loginAttempts.timestamp))
    .limit(MAX_LOGIN_HISTORY);

  return rows.map((r) => ({
    ...r,
    timestamp: r.timestamp?.toISOString() ?? null,
  }));
}
