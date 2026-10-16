import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyEdgeAccessToken, isPlatformEdge } from '@/lib/edge-auth';

// Edge runtime: no Node builtins, no TCP database access. Verifies the JWT
// signature (jose) and enforces coarse fencing from embedded claims:
//   - /admin*                → platform operators only
//   - subscription-blocked    → /subscription/inactive (pages only)
// APIs keep the historic presence check; authoritative auth (signature,
// blacklist, user + tenant + subscription load) runs per-request in
// getAuthContext() on the Node runtime.
//
// Next 16 deprecates this filename in favour of `proxy.ts`, and `next dev` /
// `next build` warn about it on every boot. Kept deliberately: `proxy` can only
// run on the Node runtime, and the matcher below puts this code in front of
// every page and every /api/* request. Renaming would move per-request fencing
// off the edge and onto a serverless function (cold starts, added latency).
// Nothing here requires the edge runtime — it is a cost/placement choice.
const ACCESS_COOKIE = 'accessToken';
const REFRESH_COOKIE = 'refreshToken';

// Per-request CSP nonce (audit F-1, 2026-10-13). Production policy stamps
// Next's own script tags with this nonce via 'strict-dynamic' and drops
// 'unsafe-inline' entirely: any injected inline script then fails to execute.
// Development keeps 'unsafe-inline' + 'unsafe-eval' — Turbopack/HMR evaluates
// modules and injects bootstraps that cannot carry a nonce.
const isDev = process.env.NODE_ENV === 'development';

function buildCsp(nonce: string): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

// Same-origin only. The app serves its own UI and API from one origin and
// never accepts cross-site credentialed requests; a hostile page therefore has
// no reason to send a form POST / XHR carrying the session cookie. State-
// changing methods are additionally Origin-checked below (CSRF).
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetch/XHR may omit Origin
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

// Exact public pages + public auth endpoints. Everything else requires a
// valid session token to even load.
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  // Self-serve tenant onboarding (page + its endpoint). The endpoint enforces
  // platform_settings.allow_public_registration; the edge only lets it through.
  '/signup',
  '/api/auth/signup',
  '/register',
  '/subscription/inactive',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  // Liveness probe (#50). Must answer without a session: its whole purpose is
  // telling the offline banner whether the server process is reachable again
  // after an outage — including the case where the session just died.
  '/api/health',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Defense in depth for the deleted x-user-* identity branch
  // (lib/middleware/auth.ts): strip any client-supplied identity headers so a
  // reintroduced trust-headers path can never be fed from the internet.
  const cleanHeaders = new Headers(request.headers);
  for (const h of ['x-user-id', 'x-user-role', 'x-tenant-id', 'x-user-email', 'x-user-permissions', 'x-user-name', 'x-user-member-id']) {
    cleanHeaders.delete(h);
  }
  // One nonce per request. Forwarded on the REQUEST so Next stamps its own
  // script tags with it, echoed on the RESPONSE so the browser enforces it.
  // The request-side copy is read by Next's bootstrap only.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);
  cleanHeaders.set('x-nonce', nonce);
  cleanHeaders.set('content-security-policy', csp);
  const forward = () => {
    const response = NextResponse.next({ request: { headers: cleanHeaders } });
    response.headers.set('content-security-policy', csp);
    return response;
  };

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return forward();
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/'),
  );

  // CSRF: reject a cross-site form POST / fetch that carries our cookie.
  // Server-side enforcement — the SameSite cookie attribute alone is only a
  // browser-side signal and is not honoured by every client. Login/refresh and
  // other public endpoints are exempt because they are reached before a
  // session exists (and login itself is rate-limited + credential-checked).
  const method = request.method.toUpperCase();
  const isStateChanging = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (isStateChanging && !isPublic && !sameOrigin(request)) {
    return NextResponse.json(
      { success: false, message: 'Cross-site request blocked', code: 'CSRF_BLOCKED' },
      { status: 403 },
    );
  }

  if (isPublic) {
    return forward();
  }

  // Scheduled jobs authenticate with a shared CRON_SECRET bearer, never a
  // session cookie, so they cannot pass the cookie-presence check below.
  // Bypassed at the edge; the route handler enforces the secret itself.
  if (pathname.startsWith('/api/cron/')) {
    return forward();
  }

  // APIs: presence check only (historic behavior); route handlers verify.
  if (pathname.startsWith('/api/')) {
    if (request.cookies.has(ACCESS_COOKIE)) {
      return forward();
    }
    return NextResponse.json(
      { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyEdgeAccessToken(token) : null;

  // A session with a fresh refresh token but an expired access token must be
  // allowed through to /login so the client can call /api/auth/refresh instead
  // of being hard-redirected to a page that throws away the still-valid
  // session. Without this, a 15-minute access token made refresh unreachable
  // from any page navigation (the client only mints a new one on a 401 from a
  // loaded page).
  if (!claims && request.cookies.has(REFRESH_COOKIE)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('refresh', '1');
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (!claims) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const platform = isPlatformEdge(claims);

  if (pathname.startsWith('/admin') && !platform) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (
    claims.subscriptionBlocked &&
    !platform &&
    !pathname.startsWith('/subscription')
  ) {
    return NextResponse.redirect(new URL('/subscription/inactive', request.url));
  }

  return forward();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
