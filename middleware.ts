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
const ACCESS_COOKIE = 'accessToken';

// Exact public pages + public auth endpoints. Everything else requires a
// valid session token to even load.
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/register',
  '/subscription/inactive',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/'),
  );
  if (isPublic) {
    return NextResponse.next();
  }

  // APIs: presence check only (historic behavior); route handlers verify.
  if (pathname.startsWith('/api/')) {
    if (request.cookies.has(ACCESS_COOKIE)) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyEdgeAccessToken(token) : null;
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

  return NextResponse.next();
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
