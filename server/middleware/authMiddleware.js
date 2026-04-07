import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import BlacklistedToken from '../models/BlacklistedToken.js';

const createAuthError = (message, code, name = 'Error') => {
 const error = new Error(message);
 error.code = code;
 error.name = name;
 return error;
};

const protect = asyncHandler(async (req, res, next) => {
 let token;

 if (
 req.headers.authorization &&
 req.headers.authorization.startsWith('Bearer')
 ) {
 try {
 token = req.headers.authorization.split(' ')[1];

 // Check if token is blacklisted
 const isBlacklisted = await BlacklistedToken.findOne({ token });
 if (isBlacklisted) {
 res.status(401);
 throw new Error('Token has been revoked, please login again');
 }

 // Verify token
 let decoded;
 try {
 decoded = jwt.verify(token, process.env.JWT_SECRET);
 } catch (err) {
 res.status(401);
 if (err.name === 'TokenExpiredError') {
 throw createAuthError('Access token expired', 'TOKEN_EXPIRED', 'TokenExpiredError');
 }
 if (err.name === 'JsonWebTokenError') {
 throw createAuthError('Invalid access token', 'INVALID_TOKEN', 'JsonWebTokenError');
 }
 throw createAuthError('Not authorized, token failed', 'TOKEN_INVALID');
 }

 // Verify it's an access token
 if (decoded.type !== 'access') {
 res.status(401);
 throw new Error('Invalid token type, access token required');
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
 throw createAuthError('Not authorized, token failed', 'TOKEN_INVALID');
 }
 }

 if (!token) {
 res.status(401);
 throw new Error('Not authorized, no token');
 }
});

const admin = (req, res, next) => {
 if (req.user && (req.user.role === 'Admin' || req.user.role === 'Administrator')) {
 next();
 } else {
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

const requireRole = (...roles) => {
 return (req, res, next) => {
 if (!req.user) {
 res.status(401);
 throw new Error('Not authorized, no user found');
 }

 if (!roles.includes(req.user.role)) {
 res.status(403);
 throw new Error(`Not authorized. Required role: ${roles.join(' or ')}.`);
 }

 next();
 };
};

/**
 * Check if user has required permission level for a specific screen
 * @param {string} screen - The AppScreen to check (e.g., 'MEMBERS', 'DEPOSITS')
 * @param {string} requiredLevel - The required AccessLevel ('READ' or 'WRITE')
 */
const requirePermission = (screen, requiredLevel = 'WRITE') => {
 return (req, res, next) => {
 if (!req.user) {
 res.status(401);
 throw new Error('Not authorized, no user found');
 }

 // Permissions can be either a Map or a plain object
 const userPermission = req.user.permissions instanceof Map
 ? req.user.permissions.get(screen)
 : req.user.permissions?.[screen];

 // Check if user has any access to the screen
 if (!userPermission || userPermission === 'NONE') {
 res.status(403);
 throw new Error(`Access denied. You do not have permission to access ${screen.toLowerCase().replace('_', ' ')}.`);
 }

 // Check if user has required level (WRITE requires WRITE, READ accepts both READ and WRITE)
 if (requiredLevel === 'WRITE' && userPermission !== 'WRITE') {
 res.status(403);
 throw new Error(`Insufficient permissions. Write access required for this operation on ${screen.toLowerCase().replace('_', ' ')}.`);
 }

 next();
 };
};

export { protect, admin, managerOrAdmin, requireRole, requirePermission };
