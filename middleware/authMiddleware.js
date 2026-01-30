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
    if (req.user && req.user.role === 'Administrator') {
        console.log('[Auth] Admin check PASSED');
        next();
    } else {
        console.log('[Auth] Admin check FAILED');
        res.status(403);
        throw new Error('Not authorized as an admin');
    }
};

const managerOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'Administrator' || req.user.role === 'Manager')) {
        next();
    } else {
        res.status(403);
        throw new Error('Not authorized. Management access required.');
    }
};

export { protect, admin, managerOrAdmin };
