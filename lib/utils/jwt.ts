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
  /** Binds both token types to one revocable server-side session. */
  sessionId?: string;
}

export interface AccessTokenClaims {
  role?: string;
  email?: string;
  tenantId?: string | null;
  subscriptionBlocked?: boolean;
  impersonatedBy?: string;
  sessionId?: string;
}

// Secrets must be long enough that HS256 cannot be brute-forced offline from a
// captured token. Fail closed on presence AND length (audit 07 M-1/L-3): an
// explicit-but-weak secret must never deploy silently.
const JWT_SECRET_MIN_LENGTH = 32;
const JWT_REFRESH_SECRET_MIN_LENGTH = 16;

function requireSecret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET', minLength: number): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters (got ${value.length})`);
  }
  return value;
}

function getSecret(type: 'access' | 'refresh'): string {
  if (type === 'refresh') {
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (refreshSecret) {
      // Explicitly configured: honor it, but reject weak values instead of
      // silently falling back to the derived secret.
      return requireSecret('JWT_REFRESH_SECRET', JWT_REFRESH_SECRET_MIN_LENGTH);
    }
    return crypto
      .createHmac('sha256', requireSecret('JWT_SECRET', JWT_SECRET_MIN_LENGTH))
      .update('investwise_refresh_secret_salt_v2')
      .digest('hex');
  }
  return requireSecret('JWT_SECRET', JWT_SECRET_MIN_LENGTH);
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
  return jwt.sign({ id: userId, type: 'access', ...claims } satisfies TokenPayload, getSecret('access'), {
    algorithm: JWT_ALGORITHM,
    expiresIn,
  });
}

export function generateRefreshToken(
  userId: string,
  sessionId?: string,
  expiresIn: NonNullable<jwt.SignOptions['expiresIn']> = REFRESH_TOKEN_EXPIRY,
  impersonatedBy?: string,
): string {
  return jwt.sign(
    {
      id: userId,
      type: 'refresh',
      ...(sessionId ? { sessionId } : {}),
      ...(impersonatedBy ? { impersonatedBy } : {}),
    } satisfies TokenPayload,
    getSecret('refresh'),
    {
    algorithm: JWT_ALGORITHM,
    expiresIn,
  });
}

export function generateTokenPair(userId: string, claims?: AccessTokenClaims): { accessToken: string; refreshToken: string } {
  return {
    accessToken: generateAccessToken(userId, claims),
    refreshToken: generateRefreshToken(userId, claims?.sessionId, REFRESH_TOKEN_EXPIRY, claims?.impersonatedBy),
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