import type { Response } from 'express';
import { isProduction } from '../config/env.js';

export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
} as const;

// 15 minutes for access token, 7 days for refresh token
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function setAuthCookies(res: Response, accessToken: string, refreshToken?: string) {
  const isSecure = isProduction;
  const sameSite = isProduction ? 'strict' : 'lax';

  res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: '/',
  });

  if (refreshToken) {
    res.cookie(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: '/api/auth',
    });
  }
}

export function clearAuthCookies(res: Response) {
  const isSecure = isProduction;
  const sameSite = isProduction ? 'strict' : 'lax';

  res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN, {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: '/',
  });

  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: '/api/auth',
  });
}
