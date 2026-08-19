import jwt from 'jsonwebtoken';
import { env, isProduction } from '../config/env.js';
import { AuthError } from '../shared/errors.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface TokenPayload {
  id: string;
  type: 'access' | 'refresh';
}

import crypto from 'node:crypto';

function getSecret(type: 'access' | 'refresh'): string {
  if (type === 'refresh') {
    if (env.JWT_REFRESH_SECRET && env.JWT_REFRESH_SECRET.length >= 16) {
      return env.JWT_REFRESH_SECRET;
    }
    // Secure fallback: derive a distinct 256-bit refresh secret from JWT_SECRET
    return crypto.createHmac('sha256', env.JWT_SECRET).update('investwise_refresh_secret_salt_v2').digest('hex');
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
