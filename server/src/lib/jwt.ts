import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { AuthError } from '../shared/errors';

export interface TokenPayload {
  id: string;
  type: 'access' | 'refresh';
  sessionId?: string;
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
    // Same derivation as the live root stack (lib/utils/jwt.ts). The two
    // copies previously derived DIFFERENT refresh secrets (this one used
    // jwt.sign with a salt payload, the root uses an HMAC), so a token minted
    // by one stack would not verify in the other — audit finding F-9. The
    // derivation matters even though no live caller currently reaches the
    // refresh branch here (session.ts verifies access tokens only).
    return crypto.createHmac('sha256', base).update('investwise_refresh_secret_salt_v2').digest('hex');
  }
  return base;
}

export function verifyToken(token: string, type: 'access' | 'refresh'): TokenPayload {
  try {
    // Pin the algorithm (HS256) exactly like the root stack (lib/utils/jwt.ts)
    // so this copy cannot drift into an algorithm-confusion surface (audit 07 L-4).
    const decoded = jwt.verify(token, getSecret(type), { algorithms: ['HS256'] }) as TokenPayload;
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
