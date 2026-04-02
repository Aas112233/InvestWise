import Session from '../models/Session.js';
import LoginAttempt from '../models/LoginAttempt.js';
import AuditLog from '../models/AuditLog.js';
import crypto from 'crypto';

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
    
    // Simple parsing (in production, use ua-parser-js library)
    const browser = ua.match(/(chrome|firefox|safari|edge|opera)/i)?.[0] || 'Unknown';
    const os = ua.match(/(windows|mac|linux|android|ios)/i)?.[0] || 'Unknown';
    const device = /mobile/i.test(ua) ? 'Mobile' : /tablet/i.test(ua) ? 'Tablet' : 'Desktop';
    
    return { browser, os, device, userAgent: ua };
};

/**
 * Get location from IP (simplified - use ipinfo API in production)
 */
const getLocationFromIP = async (ip) => {
    // In production, use: https://ipinfo.io/json?token=YOUR_TOKEN
    // For now, return basic info
    return {
        country: 'Unknown',
        city: 'Unknown',
        region: 'Unknown',
    };
};

/**
 * Check if account should be locked due to failed attempts
 */
const checkAccountLockout = async (email) => {
    const recentAttempts = await LoginAttempt.find({
        email: email.toLowerCase(),
        success: false,
        timestamp: { $gte: new Date(Date.now() - LOCKOUT_DURATION_MS) }
    }).sort({ timestamp: -1 });

    if (recentAttempts.length >= MAX_LOGIN_ATTEMPTS) {
        const oldestAttempt = recentAttempts[recentAttempts.length - 1];
        const lockoutEnds = new Date(oldestAttempt.timestamp.getTime() + LOCKOUT_DURATION_MS);
        
        return {
            isLocked: true,
            lockoutEnds,
            attemptsRemaining: 0,
            retryAfter: Math.ceil((lockoutEnds - new Date()) / 1000 / 60) // minutes
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
        await LoginAttempt.create({
            email: email.toLowerCase(),
            ipAddress,
            userAgent,
            success,
            failureReason,
            userId,
            location
        });

        // Also log to audit trail
        await AuditLog.create({
            user: userId,
            userName: email,
            action: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
            resourceType: 'Auth',
            details: {
                email,
                ipAddress,
                failureReason,
                location
            },
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
    const sessionId = generateSessionId();
    const { browser, os, device } = parseUserAgent(userAgent);

    const session = await Session.create({
        user: user._id,
        sessionId,
        ipAddress,
        userAgent,
        location,
        deviceInfo: device,
        osInfo: os,
        browserInfo: browser,
        lastActivity: new Date()
    });

    return { sessionId, session };
};

/**
 * Update session activity
 */
const updateSessionActivity = async (sessionId) => {
    await Session.findOneAndUpdate(
        { sessionId },
        { lastActivity: new Date() }
    );
};

/**
 * End session (logout)
 */
const endSession = async (sessionId, reason = 'user_logout') => {
    try {
        const session = await Session.findOneAndUpdate(
            { sessionId },
            {
                isActive: false,
                isExpired: reason === 'session_timeout',
                logoutTime: new Date()
            }
        );

        if (session) {
            await AuditLog.create({
                user: session.user,
                action: 'LOGOUT',
                resourceType: 'Auth',
                details: {
                    sessionId,
                    reason,
                    sessionDuration: new Date() - session.loginTime
                },
                ipAddress: session.ipAddress,
                status: 'SUCCESS'
            });
        }

        return session;
    } catch (error) {
        console.error('Failed to end session:', error);
    }
};

/**
 * Get active sessions for user
 */
const getActiveSessions = async (userId) => {
    return await Session.find({
        user: userId,
        isActive: true
    }).sort({ loginTime: -1 });
};

/**
 * Revoke all sessions for user (logout from all devices)
 */
const revokeAllSessions = async (userId, reason = 'user_request') => {
    await Session.updateMany(
        { user: userId, isActive: true },
        {
            isActive: false,
            isExpired: true,
            logoutTime: new Date()
        }
    );

    await AuditLog.create({
        user: userId,
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
    const anomalies = [];

    // Check for multiple locations in short time
    const recentSessions = await Session.find({
        user: { $in: await LoginAttempt.distinct('userId', { email }) },
        loginTime: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
    });

    const locations = new Set(recentSessions.map(s => s.location?.country));
    if (locations.size > 1 && location?.country && locations.has(location.country)) {
        anomalies.push({
            type: 'IMPOSSIBLE_TRAVEL',
            severity: 'HIGH',
            message: 'Login from multiple countries within short time'
        });
    }

    // Check for multiple failed attempts from same IP
    const failedAttemptsFromIP = await LoginAttempt.countDocuments({
        ipAddress,
        success: false,
        timestamp: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
    });

    if (failedAttemptsFromIP > 10) {
        anomalies.push({
            type: 'BRUTE_FORCE',
            severity: 'CRITICAL',
            message: 'Multiple failed login attempts from same IP'
        });
    }

    // Check for new device/browser
    const knownDevices = await Session.find({
        user: { $in: await LoginAttempt.distinct('userId', { email }) },
        userAgent
    });

    if (knownDevices.length === 0) {
        anomalies.push({
            type: 'NEW_DEVICE',
            severity: 'MEDIUM',
            message: 'Login from unrecognized device/browser'
        });
    }

    // Log anomalies if detected
    if (anomalies.length > 0) {
        await AuditLog.create({
            action: 'SECURITY_ANOMALY_DETECTED',
            resourceType: 'Auth',
            details: {
                email,
                ipAddress,
                anomalies,
                location
            },
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
    await AuditLog.create({
        user: user._id,
        userName: user.email,
        action,
        resourceType,
        resourceId,
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
    const result = await Session.updateMany(
        {
            isActive: true,
            lastActivity: { $lt: new Date(Date.now() - SESSION_TIMEOUT_MS) }
        },
        {
            isActive: false,
            isExpired: true,
            logoutTime: new Date()
        }
    );

    if (result.modifiedCount > 0) {
        console.log(`🧹 Cleaned up ${result.modifiedCount} expired sessions`);
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
