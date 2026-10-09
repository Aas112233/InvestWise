export const COOKIE_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
} as const;

// maxAge is in SECONDS for the Next.js cookies API — 15 min / 7 days.
// (Was mistakenly multiplied by 1000: access cookie lived ~10 days, refresh
// until 2045. JWT expiry still governed server-side, but the cookie lifetimes
// must match the token design.)
const ACCESS_COOKIE_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function setAuthCookies(
  cookies: { set: (name: string, value: string, options: CookieOptions) => void },
  accessToken: string,
  refreshToken?: string,
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const sameSite = isProduction ? 'strict' : 'lax' as const;

  cookies.set(COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: ACCESS_COOKIE_MAX_AGE,
    path: '/',
  });

  if (refreshToken) {
    cookies.set(COOKIE_NAMES.REFRESH_TOKEN, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite,
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: '/api/auth',
    });
  }
}

export function clearAuthCookies(
  cookies: { delete: (name: string, options?: { path?: string }) => any } | any,
): void {
  // A cookie can only be deleted by a Set-Cookie whose path matches the one it
  // was written with. The refresh cookie is scoped to path='/api/auth' (see
  // setAuthCookies), so deleting it with the default path='/' left it in the
  // jar — a stale refresh token survived logout and could still be exchanged
  // for a fresh session. Delete each cookie on the exact path it was set on.
  cookies.delete(COOKIE_NAMES.ACCESS_TOKEN, { path: '/' });
  cookies.delete(COOKIE_NAMES.REFRESH_TOKEN, { path: '/api/auth' });
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path: string;
}