import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_TOKEN_EXPIRY = '15m' as const;
const REFRESH_TOKEN_EXPIRY = '7d' as const;

export interface TokenPayload {
  id: string;
  type: 'access' | 'refresh';
  // Edge-readable claims (Pathshala-Pro port): embedded at issuance so the
  // edge middleware can fence /admin + blocked subscriptions without a DB hit.
  // Authoritative checks still run per-request in getAuthContext(); tokens are
  // short-lived (15m) to bound claim staleness. Authorization derives from
  // role (lib/roles.ts) — numeric access levels were removed.
  role?: string;
  email?: string;
  tenantId?: string | null;
  subscriptionBlocked?: boolean;
  impersonatedBy?: string;
}

export interface AccessTokenClaims {
  role?: string;
  email?: string;
  tenantId?: string | null;
  subscriptionBlocked?: boolean;
  impersonatedBy?: string;
}

function getSecret(type: 'access' | 'refresh'): string {
  if (type === 'refresh') {
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (refreshSecret && refreshSecret.length >= 16) {
      return refreshSecret;
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not set');
    }
    return crypto.createHmac('sha256', jwtSecret).update('investwise_refresh_secret_salt_v2').digest('hex');
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
  }
  return jwtSecret;
}

// HMAC-SHA256 everywhere: the secrets are symmetric strings, so pinning the
// algorithm at both sign and verify removes any future algorithm-confusion
// surface (jsonwebtoken already rejects alg=none, this makes it explicit).
const JWT_ALGORITHM = 'HS256' as const;

export function generateAccessToken(
  userId: string,
  claims?: AccessTokenClaims,
  expiresIn: NonNullable<jwt.SignOptions['expiresIn']> = ACCESS_TOKEN_EXPIRY,
): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set');
  }
  return jwt.sign({ id: userId, type: 'access', ...claims } satisfies TokenPayload, jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn,
  });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ id: userId, type: 'refresh' } satisfies TokenPayload, getSecret('refresh'), {
    algorithm: JWT_ALGORITHM,
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function generateTokenPair(userId: string, claims?: AccessTokenClaims): { accessToken: string; refreshToken: string } {
  return {
    accessToken: generateAccessToken(userId, claims),
    refreshToken: generateRefreshToken(userId),
  };
}

export function verifyToken(token: string, type: 'access' | 'refresh'): TokenPayload {
  try {
    const decoded = jwt.verify(token, getSecret(type), {
      algorithms: [JWT_ALGORITHM],
    }) as TokenPayload;
    if (decoded.type !== type) {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
}

export { blacklistToken } from '@/lib/middleware/auth';