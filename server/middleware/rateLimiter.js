import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
 windowMs: 15 * 60 * 1000, // 15 minutes
 max: 20, // Reduced for better security
 message: { message: 'Too many login attempts, please try again later' },
 standardHeaders: true,
 legacyHeaders: false,
});

export const apiLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: 500, // Reduced from 1000
 message: 'Too many requests, please try again later',
});

// Stricter limits for financial operations
export const financialOpLimiter = rateLimit({
 windowMs: 15 * 60 * 1000, // 15 minutes
 max: 50, // Max 50 financial operations per 15 minutes
 message: { 
 success: false,
 message: 'Too many financial operations. Please contact support if you need to perform more transactions.' 
 },
 standardHeaders: true,
 legacyHeaders: false,
 keyGenerator: (req) => {
 // Rate limit by user ID if authenticated, otherwise by IP
 return req.user?._id?.toString() || req.ip;
 }
});
