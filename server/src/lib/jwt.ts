import jwt from 'jsonwebtoken';
import { env, isProduction } from '../config/env.js';
import { AuthError } from '../shared/errors.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface TokenPayload {
  id: string;
  type: 'access' | 'refresh';
}

function getSecret(type: 'access' | 'refresh'): string {
  if (type === 'refresh') {
    if (!env.JWT_REFRESH_SECRET) {
      if (isProduction) {
        throw new Error(
          'JWT_REFRESH_SECRET is required. ' +
          'Using JWT_SECRET for refresh tokens creates a security risk — ' +
          'if the access-token secret is ever compromised, an attacker can forge valid refresh tokens too. ' +
          'Set a distinct JWT_REFRESH_SECRET (min 32 chars) in your environment.'
        );
      }
      console.warn(
        '⚠ JWT_REFRESH_SECRET not set — falling back to JWT_SECRET for refresh tokens. ' +
        'This is acceptable in development but MUST be fixed before deploying to production.'
      );
      return env.JWT_SECRET;
    }
    return env.JWT_REFRESH_SECRET;
  }
  return env.JWT_SECRET;
}

export function generateAccessToken(userId: string): string {
  return jwt.sign({ id: userId, type: 'access' } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ id: userId, type: 'refresh' } satisfies TokenPayload, getSecret('refresh'), {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function generateTokenPair(userId: string): { accessToken: string; refreshToken: string } {
  return {
    accessToken: generateAccessToken(userId),
    refreshToken: generateRefreshToken(userId),
  };
}

export function verifyToken(token: string, type: 'access' | 'refresh'): TokenPayload {
  try {
    const decoded = jwt.verify(token, getSecret(type)) as TokenPayload;
    if (decoded.type !== type) {
      throw new AuthError('Invalid token type', 'INVALID_TOKEN');
    }
    return decoded;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthError('Token has expired', 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthError('Invalid token', 'INVALID_TOKEN');
    }
    throw new AuthError('Token verification failed', 'TOKEN_INVALID');
  }
}
