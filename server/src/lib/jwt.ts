import jwt from 'jsonwebtoken';
import { AuthError } from '../shared/errors.js';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

export interface TokenPayload {
  id: string;
  type: 'access' | 'refresh';
}

export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
} as const;

function getSecret(type: 'access' | 'refresh'): string {
  const base = process.env.JWT_SECRET;
  if (!base) throw new AuthError('Server authentication is not configured', 'SERVER_MISCONFIGURED');
  if (type === 'refresh') {
    const explicit = process.env.JWT_REFRESH_SECRET;
    if (explicit && explicit.length >= 16) return explicit;
    return jwt.sign({ salt: 'investwise_refresh_secret_salt_v2' }, base);
  }
  return base;
}

export function generateAccessToken(userId: string): string {
  return jwt.sign({ id: userId, type: 'access' } satisfies TokenPayload, getSecret('access'), {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ id: userId, type: 'refresh' } satisfies TokenPayload, getSecret('refresh'), {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
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
    throw new AuthError('Invalid token', 'INVALID_TOKEN');
  }
}
