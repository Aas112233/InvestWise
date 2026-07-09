import asyncHandler from 'express-async-handler';
import bcrypt from 'bcryptjs';
import { generateTokenPair, getSecret } from '../utils/generateToken.js';
import { logAudit } from '../utils/auditLogger.js';
import jwt from 'jsonwebtoken';
import sessionManager from '../utils/sessionManager.js';
import { getDb } from '../db/connection.js';
import { users, blacklistedTokens, loginAttempts } from '../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';

// Password hashing helpers (replaces Mongoose pre-save hook + matchPassword method)
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

const matchPassword = async (enteredPassword, hashedPassword) => {
  return await bcrypt.compare(enteredPassword, hashedPassword);
};

// @desc Auth user & get token
// @route POST /api/auth/login
// @access Public
const authUser = asyncHandler(async (req, res) => {
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

  const db = getDb();
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

  if (await matchPassword(password, user.password)) {
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
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

    // Generate token pair
    const { accessToken, refreshToken } = generateTokenPair(user.id);

    // Create session
    const { sessionId } = await sessionManager.createSession({
      user,
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
      permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
      avatar: user.avatar,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      sessionId,
      securityAlert: anomalies.length > 0 ? {
        message: 'Unusual login activity detected',
        anomalies: anomalies.map(a => ({ type: a.type, severity: a.severity }))
      } : null
    });
  } else {
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
// @access Private/Admin
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, memberId, permissions } = req.body;

  if (!password || password.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(password)) {
    res.status(400);
    throw new Error('Password must include at least one uppercase letter, one lowercase letter, one number, and one special character');
  }

  const db = getDb();
  const [userExists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);

  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  const allowedRole = req.user?.role === 'Admin' && role ? role : 'Member';

  const hashedPassword = await hashPassword(password);

  const [user] = await db.insert(users).values({
    name,
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    role: allowedRole,
    status: 'active',
    memberId: memberId || null,
    permissions: (req.user?.role === 'Admin' && permissions) ? permissions : {},
  }).returning();

  if (user) {
    const { accessToken, refreshToken } = generateTokenPair(user.id);

    await logAudit({
      req,
      user: req.user || user,
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
      permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
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
  const [user] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    status: users.status,
    permissions: users.permissions,
    avatar: users.avatar,
    memberId: users.memberId,
  }).from(users).where(eq(users.id, req.user.id || req.user._id)).limit(1);

  if (user) {
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
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

  const formattedUsers = allUsers.map(user => ({
    ...user,
    _id: user.id,
    permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
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
    const [updatedUser] = await db.update(users).set({
      name: req.body.name || user.name,
      email: req.body.email || user.email,
      role: req.body.role || user.role,
      status: req.body.status || user.status,
      permissions: req.body.permissions || user.permissions,
      updatedAt: new Date(),
    }).where(eq(users.id, req.params.id)).returning();

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
      permissions: updatedUser.permissions instanceof Map ? Object.fromEntries(updatedUser.permissions) : updatedUser.permissions,
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
  // A-04: Prevent admin from deleting themselves
  if (req.params.id === (req.user.id || req.user._id).toString()) {
    res.status(400);
    throw new Error('You cannot delete your own account. Another admin must perform this action.');
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // A-04: Prevent deleting the last admin
  if (user.role === 'Admin') {
    const [adminCount] = await db.select({ count: count() })
      .from(users)
      .where(and(eq(users.role, 'Admin'), eq(users.status, 'active')));
    if (Number(adminCount.count) <= 1) {
      res.status(400);
      throw new Error('Cannot delete the last admin account. At least one active admin must exist.');
    }
  }

  await db.delete(users).where(eq(users.id, req.params.id));

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
  const { password } = req.body;

  if (!password) {
    res.status(400);
    throw new Error('Password is required');
  }

  if (password.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(password)) {
    res.status(400);
    throw new Error('Password must include uppercase, lowercase, number, and special character');
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
  if (user) {
    const hashedPassword = await hashPassword(password);
    await db.update(users).set({
      password: hashedPassword,
      updatedAt: new Date(),
    }).where(eq(users.id, req.params.id));

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
  const { oldPassword, newPassword } = req.body;

  if (!newPassword) {
    res.status(400);
    throw new Error('New password is required');
  }

  if (newPassword.length < 12) {
    res.status(400);
    throw new Error('Password must be at least 12 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/;
  if (!passwordRegex.test(newPassword)) {
    res.status(400);
    throw new Error('Password must include uppercase, lowercase, number, and special character');
  }

  const db = getDb();
  const userId = req.user.id || req.user._id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (user && (await matchPassword(oldPassword, user.password))) {
    const hashedPassword = await hashPassword(newPassword);
    await db.update(users).set({
      password: hashedPassword,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));

    await logAudit({
      req,
      user,
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
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    throw new Error('Refresh token is required');
  }

  const db = getDb();

  // Check if token is blacklisted
  const [blacklisted] = await db.select().from(blacklistedTokens).where(eq(blacklistedTokens.token, refreshToken)).limit(1);
  if (blacklisted) {
    res.status(401);
    throw new Error('Token has been revoked');
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, getSecret('refresh'));
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired refresh token');
  }

  if (decoded.type !== 'refresh') {
    res.status(401);
    throw new Error('Invalid token type');
  }

  const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, decoded.id)).limit(1);
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
  } catch (err) {
    // If token is already blacklisted (duplicate key), that's fine
    if (err.code !== '23505') { // PostgreSQL unique violation
      console.error('Failed to blacklist old refresh token:', err);
    }
  }

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
  const { refreshToken, sessionId } = req.body;

  if (sessionId) {
    await sessionManager.endSession(sessionId, 'user_logout');
  }

  if (refreshToken) {
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded && decoded.exp) {
        const db = getDb();
        await db.insert(blacklistedTokens).values({
          token: refreshToken,
          type: 'refresh',
          userId: req.user.id || req.user._id,
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

// @desc Logout from all devices
// @route POST /api/auth/logout-all
// @access Private
const logoutAllDevices = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  await sessionManager.revokeAllSessions(userId, 'user_request');

  // Blacklist all tokens for this user
  const db = getDb();
  await db.update(blacklistedTokens)
    .set({ reason: 'security' })
    .where(eq(blacklistedTokens.userId, userId));

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
  const userId = req.user.id || req.user._id;
  const sessions = await sessionManager.getActiveSessions(userId);

  res.json({
    count: sessions.length,
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      device: s.deviceInfo,
      browser: s.browserInfo,
      os: s.osInfo,
      location: s.locationCountry ? { country: s.locationCountry, city: s.locationCity, region: s.locationRegion } : {},
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
  const userId = req.user.id || req.user._id;
  const attempts = await db.select()
    .from(loginAttempts)
    .where(eq(loginAttempts.userId, userId))
    .orderBy(desc(loginAttempts.timestamp))
    .limit(50);

  res.json({
    count: attempts.length,
    attempts: attempts.map(a => ({
      timestamp: a.timestamp,
      success: a.success,
      ipAddress: a.ipAddress,
      location: a.locationCountry ? { country: a.locationCountry, city: a.locationCity } : {},
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
