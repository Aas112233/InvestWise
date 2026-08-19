import rateLimit from 'express-rate-limit';
import { isProduction } from '../config/env.js';

/**
 * Rate limiters.
 *
 * IMPORTANT: These use the default in-memory store. In a serverless/multi-instance
 * deployment (Vercel, scaled Render, etc.), the in-memory store resets per process,
 * so brute-force and burst protection is inconsistent across instances.
 *
 * For production multi-instance deployments, swap the store to a shared backend:
 *   import { RedisStore } from 'rate-limit-redis';
 *   const store = new RedisStore({ client: redisClient });
 *
 * @see https://www.npmjs.com/package/express-rate-limit#store
 */

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { success: false, message: 'Too many login attempts, please try again later', code: 'RATE_LIMITED' },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 500 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: 'Too many requests',
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // 20 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { success: false, message: 'AI request limit reached. Please wait a minute before sending another query.', code: 'AI_RATE_LIMITED' },
});
