import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { generateTokenPair } from '../utils/generateToken.js';
import BlacklistedToken from '../models/BlacklistedToken.js';
import { logAudit } from '../utils/auditLogger.js';
import jwt from 'jsonwebtoken';
import sessionManager from '../utils/sessionManager.js';
import LoginAttempt from '../models/LoginAttempt.js';

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
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

    const user = await User.findOne({ email });

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

    if (user.status === 'suspended' || user.status === 'inactive') {
        await sessionManager.recordLoginAttempt({
            email,
            ipAddress,
            userAgent,
            success: false,
            failureReason: 'account_suspended',
            userId: user._id,
            location: {}
        });

        res.status(403);
        throw new Error('Account has been suspended. Please contact support.');
    }

    if (await user.matchPassword(password)) {
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
        user.lastLogin = new Date();
        await user.save();

        // Generate token pair
        const { accessToken, refreshToken } = generateTokenPair(user._id);

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
            userId: user._id,
            location
        });

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
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
        // Record failed login
        await sessionManager.recordLoginAttempt({
            email,
            ipAddress,
            userAgent,
            success: false,
            failureReason: 'invalid_password',
            userId: user._id,
            location: {}
        });

        res.status(401);
        throw new Error('Invalid email or password');
    }
});

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
    const { name, email, password, role, memberId, permissions } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
        res.status(400);
        throw new Error('User already exists');
    }

    const user = await User.create({
        name,
        email,
        password,
        role: 'Member',
        memberId,
        permissions: {}
    });

    if (user) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            memberId: user.memberId,
            permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
            token: generateToken(user._id),
        });
    } else {
        res.status(400);
        throw new Error('Invalid user data');
    }
});

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
            avatar: user.avatar,
            memberId: user.memberId
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Get all users
// @route   GET /api/auth/users
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
    const users = await User.find({}).select('-password');
    const formattedUsers = users.map(user => ({
        ...user._doc,
        _id: user._id,
        permissions: user.permissions instanceof Map ? Object.fromEntries(user.permissions) : user.permissions,
    }));
    res.json(formattedUsers);
});

// @desc    Update user
// @route   PUT /api/auth/users/:id
// @access  Private/Admin
const updateUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.role = req.body.role || user.role;
        user.permissions = req.body.permissions || user.permissions;

        const updatedUser = await user.save();

        res.json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            role: updatedUser.role,
            permissions: updatedUser.permissions instanceof Map ? Object.fromEntries(updatedUser.permissions) : updatedUser.permissions,
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Delete user
// @route   DELETE /api/auth/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        await user.deleteOne();
        res.json({ message: 'User removed' });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Update user password (Admin only)
// @route   PUT /api/auth/users/:id/password
// @access  Private/Admin
const updateUserPassword = asyncHandler(async (req, res) => {
    const { password } = req.body;

    if (!password) {
        res.status(400);
        throw new Error('Password is required');
    }

    const user = await User.findById(req.params.id);
    if (user) {
        user.password = password;
        await user.save();
        res.json({ message: 'Password updated successfully' });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Change current user password
// @route   PUT /api/auth/profile/password
// @access  Private
const changeCurrentUserPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!newPassword) {
        res.status(400);
        throw new Error('New password is required');
    }

    const user = await User.findById(req.user._id);

    if (user && (await user.matchPassword(oldPassword))) {
        user.password = newPassword;
        await user.save();

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

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public (requires valid refresh token)
const refreshToken = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        res.status(400);
        throw new Error('Refresh token is required');
    }

    // Check if token is blacklisted
    const isBlacklisted = await BlacklistedToken.findOne({ token: refreshToken });
    if (isBlacklisted) {
        res.status(401);
        throw new Error('Token has been revoked');
    }

    // Verify refresh token
    let decoded;
    try {
        decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
        res.status(401);
        throw new Error('Invalid or expired refresh token');
    }

    // Verify it's a refresh token
    if (decoded.type !== 'refresh') {
        res.status(401);
        throw new Error('Invalid token type');
    }

    // Get user and verify they still exist
    const user = await User.findById(decoded.id);
    if (!user) {
        res.status(401);
        throw new Error('User not found');
    }

    // Generate new token pair (rotate tokens)
    const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(user._id);

    res.json({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 15 * 60,
    });
});

// @desc    Logout user (blacklist tokens and end session)
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = asyncHandler(async (req, res) => {
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
                await BlacklistedToken.create({
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

// @desc    Logout from all devices (blacklist all user tokens)
// @route   POST /api/auth/logout-all
// @access  Private
const logoutAllDevices = asyncHandler(async (req, res) => {
    // Revoke all sessions
    await sessionManager.revokeAllSessions(req.user._id, 'user_request');

    // Blacklist all tokens for this user
    await BlacklistedToken.updateMany(
        { userId: req.user._id },
        { $set: { reason: 'security' } }
    );

    await logAudit({
        req,
        user: req.user,
        action: 'LOGOUT_ALL_DEVICES',
        resourceType: 'Auth',
        details: { email: req.user.email }
    });

    res.json({ message: 'Logged out from all devices successfully' });
});

// @desc    Get active sessions for current user
// @route   GET /api/auth/sessions
// @access  Private
const getActiveSessions = asyncHandler(async (req, res) => {
    const sessions = await sessionManager.getActiveSessions(req.user._id);

    res.json({
        count: sessions.length,
        sessions: sessions.map(s => ({
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

// @desc    Revoke specific session
// @route   DELETE /api/auth/sessions/:sessionId
// @access  Private
const revokeSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    await sessionManager.endSession(sessionId, 'revoked_by_user');

    res.json({ message: 'Session revoked successfully' });
});

// @desc    Get login history for current user
// @route   GET /api/auth/login-history
// @access  Private
const getLoginHistory = asyncHandler(async (req, res) => {
    const loginAttempts = await LoginAttempt.find({
        userId: req.user._id
    }).sort({ timestamp: -1 }).limit(50);

    res.json({
        count: loginAttempts.length,
        attempts: loginAttempts.map(a => ({
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
