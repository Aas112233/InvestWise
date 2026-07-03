import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connectDB, { getDb } from '../db/connection.js';
import { users, blacklistedTokens, loginAttempts } from '../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';
import { generateTokenPair, getSecret } from '../utils/generateToken.js';
import sessionManager from '../utils/sessionManager.js';
import { logAudit } from '../utils/auditLogger.js';

/**
 * Helper: parse JSONB permissions field safely.
 */
const parsePermissions = (perms: unknown): Record<string, string> => {
  if (!perms) return {};
  if (typeof perms === 'string') {
    try { return JSON.parse(perms); } catch { return {}; }
  }
  if (typeof perms === 'object') return perms as Record<string, string>;
  return {};
};

// @desc Auth user & get token
// @route POST /api/auth/login
// @access Public
const authUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';

  // Check for account lockout first
  const lockoutStatus = await sessionManager.checkAccountLockout(email);
  if (lockoutStatus.isLocked) {
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'account_locked',
      location: {}
    });

    res.status(423);
    throw new Error(`Account temporarily locked. Try again in ${lockoutStatus.retryAfter} minutes.`);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);

  if (!user) {
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'invalid_email',
      location: {}
    });

    res.status(401);
    throw new Error('Invalid email or password');
  }

  // Check user status
  if (user.status === 'suspended') {
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'account_suspended',
      userId: user.id,
      location: {}
    });

    res.status(403);
    throw new Error('Account has been suspended. Please contact an administrator.');
  }

  if (user.status === 'inactive') {
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'account_suspended',
      userId: user.id,
      location: {}
    });

    res.status(403);
    throw new Error('Account is inactive. Please contact an administrator to reactivate.');
  }

  if (await bcrypt.compare(password, user.password)) {
    // Get location
    const location = await sessionManager.getLocationFromIP(ipAddress);

    // Detect anomalies
    const anomalies = await sessionManager.detectAnomalies({
      email,
      ipAddress,
      userAgent,
      location
    });

    // Update last login
    await db.update(users)
      .set({ lastLogin: new Date() })
      .where(eq(users.id, user.id));

    // Generate token pair
    const { accessToken, refreshToken } = generateTokenPair(user.id);

    // Create session (adapt user with _id for sessionManager compatibility)
    const { sessionId } = await sessionManager.createSession({
      user: { ...user, _id: user.id },
      ipAddress,
      userAgent,
      location
    });

    // Record successful login
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: true,
      userId: user.id,
      location
    });

    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: parsePermissions(user.permissions),
      avatar: user.avatar,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      sessionId,
      securityAlert: anomalies.length > 0 ? {
        message: 'Unusual login activity detected',
        anomalies: anomalies.map((a: { type: string; severity: string }) => ({ type: a.type, severity: a.severity }))
      } : null
    });
  } else {
    // Record failed login
    await sessionManager.recordLoginAttempt({
      email,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'invalid_password',
      userId: user.id,
      location: {}
    });

    res.status(401);
    throw new Error('Invalid email or password');
  }
});

// @desc Register a new user
// @route POST /api/auth/register
// @access Private/Admin — registration is restricted to admins only in a financial app
const registerUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const { name, email, password, role, memberId, permissions } = req.body;

  // Validate password strength for financial application
  if (!password || password.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(password)) {
    res.status(400);
    throw new Error('Password must include at least one uppercase letter, one lowercase letter, one number, and one special character');
  }

  const [userExists] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);

  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  // Only Admin can assign elevated roles; default to Member
  const allowedRole = req.user?.role === 'Admin' && role ? role : 'Member';

  // Hash password inline (replaces Mongoose pre-save hook)
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const [user] = await db.insert(users).values({
    name,
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    role: allowedRole,
    status: 'active',
    memberId,
    permissions: JSON.stringify((req.user?.role === 'Admin' && permissions) ? permissions : {}),
  }).returning();

  if (user) {
    const { accessToken, refreshToken } = generateTokenPair(user.id);

    await logAudit({
      req,
      user: req.user || { ...user, _id: user.id },
      action: 'CREATE_USER',
      resourceType: 'User',
      resourceId: user.id,
      details: { email: user.email, role: user.role, createdBy: req.user?.email || 'self-registration' }
    });

    res.status(201).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      memberId: user.memberId,
      permissions: parsePermissions(user.permissions),
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

// @desc Get user profile
// @route GET /api/auth/profile
// @access Private
const getUserProfile = asyncHandler(async (req, res) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, req.user._id)).limit(1);

  if (user) {
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: parsePermissions(user.permissions),
      avatar: user.avatar,
      memberId: user.memberId
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc Get all users
// @route GET /api/auth/users
// @access Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const db = getDb();
  const allUsers = await db.select({
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
  }).from(users);

  const formattedUsers = allUsers.map(u => ({
    ...u,
    _id: u.id,
    permissions: parsePermissions(u.permissions),
  }));

  res.json(formattedUsers);
});

// @desc Update user
// @route PUT /api/auth/users/:id
// @access Private/Admin
const updateUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);

  if (user) {
    const currentPermissions = parsePermissions(user.permissions);
    const newPermissions = req.body.permissions ? parsePermissions(req.body.permissions) : currentPermissions;

    const [updatedUser] = await db.update(users)
      .set({
        name: req.body.name || user.name,
        email: req.body.email || user.email,
        role: req.body.role || user.role,
        status: req.body.status || user.status,
        permissions: JSON.stringify(newPermissions),
      })
      .where(eq(users.id, user.id))
      .returning();

    await logAudit({
      req,
      user: req.user,
      action: 'UPDATE_USER',
      resourceType: 'User',
      resourceId: updatedUser.id,
      details: { changes: req.body }
    });

    res.json({
      _id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      status: updatedUser.status,
      permissions: parsePermissions(updatedUser.permissions),
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc Delete user
// @route DELETE /api/auth/users/:id
// @access Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const db = getDb();

  // A-04: Prevent admin from deleting themselves
  if (req.params.id === req.user._id.toString()) {
    res.status(400);
    throw new Error('You cannot delete your own account. Another admin must perform this action.');
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // A-04: Prevent deleting the last admin
  if (user.role === 'Admin') {
    const [result] = await db.select({ count: count() })
      .from(users)
      .where(and(eq(users.role, 'Admin'), eq(users.status, 'active')));

    const adminCount = Number(result.count);
    if (adminCount <= 1) {
      res.status(400);
      throw new Error('Cannot delete the last admin account. At least one active admin must exist.');
    }
  }

  await db.delete(users).where(eq(users.id, user.id));

  await logAudit({
    req,
    user: req.user,
    action: 'DELETE_USER',
    resourceType: 'User',
    resourceId: req.params.id,
    details: { deletedEmail: user.email, deletedRole: user.role }
  });

  res.json({ message: 'User removed' });
});

// @desc Update user password (Admin only)
// @route PUT /api/auth/users/:id/password
// @access Private/Admin
const updateUserPassword = asyncHandler(async (req, res) => {
  const db = getDb();
  const { password } = req.body;

  if (!password) {
    res.status(400);
    throw new Error('Password is required');
  }

  // Enforce password strength
  if (password.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(password)) {
    res.status(400);
    throw new Error('Password must include uppercase, lowercase, number, and special character');
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);

  if (user) {
    // Hash password inline (replaces Mongoose pre-save hook)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await db.update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, user.id));

    // A-05: Audit the admin password reset
    await logAudit({
      req,
      user: req.user,
      action: 'ADMIN_PASSWORD_RESET',
      resourceType: 'User',
      resourceId: user.id,
      details: {
        targetEmail: user.email,
        resetBy: req.user.email,
        message: 'Password was reset by an administrator'
      }
    });

    res.json({ message: 'Password updated successfully' });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc Change current user password
// @route PUT /api/auth/profile/password
// @access Private
const changeCurrentUserPassword = asyncHandler(async (req, res) => {
  const db = getDb();
  const { oldPassword, newPassword } = req.body;

  if (!newPassword) {
    res.status(400);
    throw new Error('New password is required');
  }

  // Enforce password strength
  if (newPassword.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(newPassword)) {
    res.status(400);
    throw new Error('Password must include uppercase, lowercase, number, and special character');
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.user._id)).limit(1);

  if (user && (await bcrypt.compare(oldPassword, user.password))) {
    // Hash new password inline
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, user.id));

    await logAudit({
      req,
      user: { ...user, _id: user.id },
      action: 'PASSWORD_CHANGE',
      resourceType: 'Auth',
      details: { email: user.email }
    });

    res.json({ message: 'Password updated successfully' });
  } else {
    res.status(401);
    throw new Error('Invalid old password');
  }
});

// @desc Refresh access token
// @route POST /api/auth/refresh
// @access Public (requires valid refresh token)
const refreshToken = asyncHandler(async (req, res) => {
  const db = getDb();
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    throw new Error('Refresh token is required');
  }

  // Check if token is blacklisted
  const [existingBlacklisted] = await db.select()
    .from(blacklistedTokens)
    .where(eq(blacklistedTokens.token, refreshToken))
    .limit(1);

  if (existingBlacklisted) {
    res.status(401);
    throw new Error('Token has been revoked');
  }

  // Verify refresh token using the REFRESH-specific secret
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, getSecret('refresh'));
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired refresh token');
  }

  // Verify it's a refresh token
  if (decoded.type !== 'refresh') {
    res.status(401);
    throw new Error('Invalid token type');
  }

  // Get user and verify they still exist and are active
  const [user] = await db.select().from(users).where(eq(users.id, decoded.id)).limit(1);

  if (!user) {
    res.status(401);
    throw new Error('User not found');
  }

  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is no longer active');
  }

  // A-03: Blacklist the OLD refresh token during rotation
  try {
    await db.insert(blacklistedTokens).values({
      token: refreshToken,
      type: 'refresh',
      userId: user.id,
      expiresAt: new Date(decoded.exp * 1000),
      reason: 'token_rotation',
    });
  } catch (err: any) {
    // If token is already blacklisted (unique constraint violation), that's fine
    // PostgreSQL unique violation code is '23505'; also check for Mongoose code 11000 for mixed env
    if (err.code !== '23505' && err.code !== 11000) {
      console.error('Failed to blacklist old refresh token:', err);
    }
  }

  // Generate new token pair (rotate tokens)
  const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(user.id);

  res.json({
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 15 * 60,
  });
});

// @desc Logout user (blacklist tokens and end session)
// @route POST /api/auth/logout
// @access Private
const logoutUser = asyncHandler(async (req, res) => {
  const db = getDb();
  const { refreshToken, sessionId } = req.body;

  // End session if sessionId provided
  if (sessionId) {
    await sessionManager.endSession(sessionId, 'user_logout');
  }

  if (refreshToken) {
    // Decode token to get expiration time
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded && decoded.exp) {
        // Blacklist the refresh token
        await db.insert(blacklistedTokens).values({
          token: refreshToken,
          type: 'refresh',
          userId: req.user._id,
          expiresAt: new Date(decoded.exp * 1000),
          reason: 'logout',
        });
      }
    } catch (error) {
      console.error('Error blacklisting token:', error);
    }
  }

  await logAudit({
    req,
    user: req.user,
    action: 'LOGOUT',
    resourceType: 'Auth',
    details: {
      email: req.user.email,
      sessionId: sessionId || null
    }
  });

  res.json({ message: 'Logout successful' });
});

// @desc Logout from all devices (blacklist all user tokens)
// @route POST /api/auth/logout-all
// @access Private
const logoutAllDevices = asyncHandler(async (req, res) => {
  const db = getDb();

  // Revoke all sessions
  await sessionManager.revokeAllSessions(req.user._id, 'user_request');

  // Blacklist all tokens for this user
  await db.update(blacklistedTokens)
    .set({ reason: 'security' })
    .where(eq(blacklistedTokens.userId, req.user._id));

  await logAudit({
    req,
    user: req.user,
    action: 'LOGOUT_ALL_DEVICES',
    resourceType: 'Auth',
    details: { email: req.user.email }
  });

  res.json({ message: 'Logged out from all devices successfully' });
});

// @desc Get active sessions for current user
// @route GET /api/auth/sessions
// @access Private
const getActiveSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionManager.getActiveSessions(req.user._id);

  res.json({
    count: sessions.length,
    sessions: sessions.map((s: any) => ({
      sessionId: s.sessionId,
      device: s.deviceInfo,
      browser: s.browserInfo,
      os: s.osInfo,
      location: s.location,
      ipAddress: s.ipAddress,
      loginTime: s.loginTime,
      lastActivity: s.lastActivity,
      current: s.sessionId === req.body.sessionId
    }))
  });
});

// @desc Revoke specific session
// @route DELETE /api/auth/sessions/:sessionId
// @access Private
const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  await sessionManager.endSession(sessionId, 'revoked_by_user');

  res.json({ message: 'Session revoked successfully' });
});

// @desc Get login history for current user
// @route GET /api/auth/login-history
// @access Private
const getLoginHistory = asyncHandler(async (req, res) => {
  const db = getDb();

  const attempts = await db.select()
    .from(loginAttempts)
    .where(eq(loginAttempts.userId, req.user._id))
    .orderBy(desc(loginAttempts.timestamp))
    .limit(50);

  res.json({
    count: attempts.length,
    attempts: attempts.map(a => ({
      timestamp: a.timestamp,
      success: a.success,
      ipAddress: a.ipAddress,
      location: a.location,
      userAgent: a.userAgent,
      failureReason: a.failureReason
    }))
  });
});

export {
  authUser,
  registerUser,
  getUserProfile,
  getUsers,
  updateUser,
  deleteUser,
  updateUserPassword,
  changeCurrentUserPassword,
  refreshToken,
  logoutUser,
  logoutAllDevices,
  getActiveSessions,
  revokeSession,
  getLoginHistory,
};
