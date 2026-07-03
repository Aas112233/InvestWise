import crypto from 'crypto';
import { getDb } from '../db/connection.js';
import { sessions, loginAttempts, auditLogs } from '../db/schema/index.js';
import { eq, and, gte, count, desc, sql } from 'drizzle-orm';

// Configuration
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Generate unique session ID
 */
const generateSessionId = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Parse user agent to extract device/browser info
 */
const parseUserAgent = (userAgent) => {
  const ua = userAgent || 'Unknown';
  const browser = ua.match(/(chrome|firefox|safari|edge|opera)/i)?.[0] || 'Unknown';
  const os = ua.match(/(windows|mac|linux|android|ios)/i)?.[0] || 'Unknown';
  const device = /mobile/i.test(ua) ? 'Mobile' : /tablet/i.test(ua) ? 'Tablet' : 'Desktop';
  return { browser, os, device, userAgent: ua };
};

/**
 * Get location from IP (simplified)
 */
const getLocationFromIP = async (ip) => {
  return { country: 'Unknown', city: 'Unknown', region: 'Unknown' };
};

/**
 * Check if account should be locked due to failed attempts
 */
const checkAccountLockout = async (email) => {
  const db = getDb();
  const recentAttempts = await db.select()
    .from(loginAttempts)
    .where(and(
      eq(loginAttempts.email, email.toLowerCase()),
      eq(loginAttempts.success, false),
      gte(loginAttempts.timestamp, new Date(Date.now() - LOCKOUT_DURATION_MS))
    ))
    .orderBy(desc(loginAttempts.timestamp));

  if (recentAttempts.length >= MAX_LOGIN_ATTEMPTS) {
    const oldestAttempt = recentAttempts[recentAttempts.length - 1];
    const lockoutEnds = new Date(new Date(oldestAttempt.timestamp).getTime() + LOCKOUT_DURATION_MS);
    return {
      isLocked: true,
      lockoutEnds,
      attemptsRemaining: 0,
      retryAfter: Math.ceil((lockoutEnds - new Date()) / 1000 / 60)
    };
  }

  return {
    isLocked: false,
    attemptsRemaining: MAX_LOGIN_ATTEMPTS - recentAttempts.length,
    retryAfter: 0
  };
};

/**
 * Record login attempt
 */
const recordLoginAttempt = async ({ email, ipAddress, userAgent, success, failureReason, userId, location }) => {
  try {
    const db = getDb();
    await db.insert(loginAttempts).values({
      email: email.toLowerCase(),
      ipAddress,
      userAgent,
      success,
      failureReason: failureReason || null,
      userId: userId || null,
      locationCountry: location?.country || null,
      locationCity: location?.city || null,
      timestamp: new Date(),
    });

    // Also log to audit trail
    await db.insert(auditLogs).values({
      userId: userId || null,
      userName: email,
      action: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      resourceType: 'Auth',
      details: { email, ipAddress, failureReason, location },
      ipAddress,
      userAgent,
      status: success ? 'SUCCESS' : 'FAILURE'
    });
  } catch (error) {
    console.error('Failed to record login attempt:', error);
  }
};

/**
 * Create new session
 */
const createSession = async ({ user, ipAddress, userAgent, location }) => {
  const db = getDb();
  const sessionId = generateSessionId();
  const { browser, os, device } = parseUserAgent(userAgent);

  const [sess] = await db.insert(sessions).values({
    userId: user.id || user._id,
    sessionId,
    ipAddress,
    userAgent,
    locationCountry: location?.country || 'Unknown',
    locationCity: location?.city || 'Unknown',
    locationRegion: location?.region || 'Unknown',
    loginTime: new Date(),
    lastActivity: new Date(),
    isActive: true,
    isExpired: false,
    deviceInfo: device,
    osInfo: os,
    browserInfo: browser,
  }).returning();

  return { sessionId, session: sess };
};

/**
 * Update session activity
 */
const updateSessionActivity = async (sessionId) => {
  const db = getDb();
  await db.update(sessions)
    .set({ lastActivity: new Date() })
    .where(eq(sessions.sessionId, sessionId));
};

/**
 * End session (logout)
 */
const endSession = async (sessionId, reason = 'user_logout') => {
  try {
    const db = getDb();
    const [session] = await db.select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);

    if (!session) return null;

    await db.update(sessions)
      .set({
        isActive: false,
        isExpired: reason === 'session_timeout',
        logoutTime: new Date(),
      })
      .where(eq(sessions.sessionId, sessionId));

    await db.insert(auditLogs).values({
      userId: session.userId,
      action: 'LOGOUT',
      resourceType: 'Auth',
      details: {
        sessionId,
        reason,
        sessionDuration: new Date() - new Date(session.loginTime)
      },
      ipAddress: session.ipAddress,
      status: 'SUCCESS'
    });

    return session;
  } catch (error) {
    console.error('Failed to end session:', error);
  }
};

/**
 * Get active sessions for user
 */
const getActiveSessions = async (userId) => {
  const db = getDb();
  return await db.select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)))
    .orderBy(desc(sessions.loginTime));
};

/**
 * Revoke all sessions for user (logout from all devices)
 */
const revokeAllSessions = async (userId, reason = 'user_request') => {
  const db = getDb();
  await db.update(sessions)
    .set({
      isActive: false,
      isExpired: true,
      logoutTime: new Date(),
    })
    .where(and(eq(sessions.userId, userId), eq(sessions.isActive, true)));

  await db.insert(auditLogs).values({
    userId,
    action: 'LOGOUT_ALL_DEVICES',
    resourceType: 'Auth',
    details: { reason },
    status: 'SUCCESS'
  });
};

/**
 * Check for suspicious activity
 */
const detectAnomalies = async ({ email, ipAddress, userAgent, location }) => {
  const db = getDb();
  const anomalies = [];

  // Get userIds associated with this email
  const userIdResults = await db.select({ userId: loginAttempts.userId })
    .from(loginAttempts)
    .where(eq(loginAttempts.email, email));

  const userIds = [...new Set(userIdResults.map(r => r.userId).filter(Boolean))];

  if (userIds.length > 0) {
    // Check for multiple locations in short time
    const recentSessions = await db.select()
      .from(sessions)
      .where(and(
        gte(sessions.loginTime, new Date(Date.now() - 60 * 60 * 1000))
      ));

    const locations = new Set(recentSessions.map(s => s.locationCountry));
    if (locations.size > 1 && location?.country && locations.has(location.country)) {
      anomalies.push({
        type: 'IMPOSSIBLE_TRAVEL',
        severity: 'HIGH',
        message: 'Login from multiple countries within short time'
      });
    }
  }

  // Check for multiple failed attempts from same IP
  const [failedCount] = await db.select({ count: count() })
    .from(loginAttempts)
    .where(and(
      eq(loginAttempts.ipAddress, ipAddress),
      eq(loginAttempts.success, false),
      gte(loginAttempts.timestamp, new Date(Date.now() - 30 * 60 * 1000))
    ));

  if (Number(failedCount?.count) > 10) {
    anomalies.push({
      type: 'BRUTE_FORCE',
      severity: 'CRITICAL',
      message: 'Multiple failed login attempts from same IP'
    });
  }

  // Check for new device/browser
  const knownDevices = await db.select()
    .from(sessions)
    .where(and(eq(sessions.userAgent, userAgent)));

  if (knownDevices.length === 0 && userIds.length > 0) {
    anomalies.push({
      type: 'NEW_DEVICE',
      severity: 'MEDIUM',
      message: 'Login from unrecognized device/browser'
    });
  }

  // Log anomalies if detected
  if (anomalies.length > 0) {
    await db.insert(auditLogs).values({
      action: 'SECURITY_ANOMALY_DETECTED',
      resourceType: 'Auth',
      details: { email, ipAddress, anomalies, location },
      ipAddress,
      status: 'WARNING'
    });
  }

  return anomalies;
};

/**
 * Log sensitive operation
 */
const logSensitiveOperation = async ({ user, action, resourceType, resourceId, details, ipAddress, userAgent }) => {
  const db = getDb();
  await db.insert(auditLogs).values({
    userId: user.id || user._id,
    userName: user.email,
    action,
    resourceType,
    resourceId: resourceId ? String(resourceId) : null,
    details,
    ipAddress,
    userAgent,
    status: 'SUCCESS'
  });
};

/**
 * Clean up expired sessions
 */
const cleanupExpiredSessions = async () => {
  const db = getDb();
  const result = await db.update(sessions)
    .set({
      isActive: false,
      isExpired: true,
      logoutTime: new Date(),
    })
    .where(and(
      eq(sessions.isActive, true),
      sql`${sessions.lastActivity} < ${new Date(Date.now() - SESSION_TIMEOUT_MS)}`
    ));

  if (result.rowCount && result.rowCount > 0) {
    console.log(`Cleaned up ${result.rowCount} expired sessions`);
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

export default {
  generateSessionId,
  checkAccountLockout,
  recordLoginAttempt,
  createSession,
  updateSessionActivity,
  endSession,
  getActiveSessions,
  revokeAllSessions,
  detectAnomalies,
  logSensitiveOperation,
  cleanupExpiredSessions,
  getLocationFromIP,
  SESSION_TIMEOUT_MS,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS
};
