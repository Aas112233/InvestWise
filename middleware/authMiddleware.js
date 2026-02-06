import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            let decoded;
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (err) {
                res.status(401);
                throw new Error('Not authorized, token failed');
            }

            // Get user from token
            try {
                req.user = await User.findById(decoded.id).select('-password');
            } catch (err) {
                console.error('Auth Middleware DB Error:', err);
                res.status(500);
                throw new Error('Server Error: Database unavailable');
            }

            if (!req.user) {
                res.status(401);
                throw new Error('Not authorized, user not found');
            }

            next();
        } catch (error) {
            // Rethrow errors that we already handled (with specific status codes)
            if (res.statusCode !== 200) throw error;

            // Fallback for unexpected errors
            console.error(error);
            res.status(401);
            throw new Error('Not authorized, token failed');
        }
    }

    if (!token) {
        res.status(401);
        throw new Error('Not authorized, no token');
    }
});

const admin = (req, res, next) => {
    console.log(`[Auth] Checking admin for user: ${req.user?._id}, role: ${req.user?.role}`);
    if (req.user && (req.user.role === 'Admin' || req.user.role === 'Administrator')) {
        console.log('[Auth] Admin check PASSED');
        next();
    } else {
        console.log('[Auth] Admin check FAILED');
        res.status(403);
        throw new Error('Not authorized as an admin');
    }
};

const managerOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'Admin' || req.user.role === 'Administrator' || req.user.role === 'Manager')) {
        next();
    } else {
        res.status(403);
        throw new Error('Not authorized. Management access required.');
    }
};

/**
 * Check if user has required permission level for a specific screen
 * @param {string} screen - The AppScreen to check (e.g., 'MEMBERS', 'DEPOSITS')
 * @param {string} requiredLevel - The required AccessLevel ('READ' or 'WRITE')
 */
const requirePermission = (screen, requiredLevel = 'WRITE') => {
    return (req, res, next) => {
        console.log(`[Permission Check] Screen: ${screen}, Required: ${requiredLevel}`);

        if (!req.user) {
            console.log('[Permission Check] FAILED - No user found');
            res.status(401);
            throw new Error('Not authorized, no user found');
        }

        console.log(`[Permission Check] User: ${req.user.email}, Role: ${req.user.role}`);
        console.log(`[Permission Check] User permissions:`, req.user.permissions);

        // Permissions can be either a Map or a plain object
        const userPermission = req.user.permissions instanceof Map
            ? req.user.permissions.get(screen)
            : req.user.permissions?.[screen];

        console.log(`[Permission Check] User permission for ${screen}:`, userPermission);

        // Check if user has any access to the screen
        if (!userPermission || userPermission === 'NONE') {
            console.log(`[Permission Check] FAILED - No access or NONE for ${screen}`);
            res.status(403);
            throw new Error(`Access denied. You do not have permission to access ${screen.toLowerCase().replace('_', ' ')}.`);
        }

        // Check if user has required level (WRITE requires WRITE, READ accepts both READ and WRITE)
        if (requiredLevel === 'WRITE' && userPermission !== 'WRITE') {
            console.log(`[Permission Check] FAILED - Insufficient permission level. Has: ${userPermission}, Needs: WRITE`);
            res.status(403);
            throw new Error(`Insufficient permissions. Write access required for this operation on ${screen.toLowerCase().replace('_', ' ')}.`);
        }

        console.log(`[Permission Check] SUCCESS - User has ${userPermission} for ${screen}, required ${requiredLevel}`);
        // User has sufficient permission
        next();
    };
};

export { protect, admin, managerOrAdmin, requirePermission };
