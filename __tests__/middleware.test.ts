import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextRequest as NextRequestType } from 'next/server';

// F-1 remediation regression tests (2026-10-13): per-request CSP nonce.
// `next dev` cannot exercise the production policy (it keeps
// 'unsafe-inline' for HMR) and `next build` is blocked in the agent shell
// (safe-delete shim), so the production branch is verified here directly:
// the middleware module re-evaluates its per-request logic with
// NODE_ENV=production and we assert the exact header plumbing.

beforeAll(() => {
  process.env.JWT_SECRET ||= 'unit-test-secret-not-a-real-key';
});

function makeRequest(path: string, init?: RequestInit): NextRequestType {
  return new NextRequest(`http://localhost:3001${path}`, init as never);
}

async function loadMiddleware(nodeEnv: 'production' | 'development') {
  vi.resetModules();
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const mod = await import('@/middleware');
    return mod.middleware as (r: NextRequestType) => Promise<Response>;
  } finally {
    process.env.NODE_ENV = previous;
  }
}

function scriptSrcOf(csp: string): string {
  const segment = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src'));
  return segment ?? '';
}

function forwardedRequestHeader(response: Response, name: string): string | null {
  // Next serialises middleware request-header overrides onto the response
  // under these reserved keys; absent means the header was not overridden.
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('middleware CSP (F-1)', () => {
  it('production: script-src carries a 32-byte nonce + strict-dynamic, no unsafe-inline', async () => {
    const middleware = await loadMiddleware('production');
    const response = await middleware(makeRequest('/login'));

    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    const scriptSrc = scriptSrcOf(csp!);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    const match = scriptSrc.match(/'nonce-([^']+)'/);
    expect(match).toBeTruthy();
    const nonce = match![1];
    // crypto.randomUUID() is a 36-char UUID string (122 bits of entropy);
    // the nonce is its UTF-8 bytes, base64-encoded.
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(nonce, 'base64')).toHaveLength(36);
    // The forwarded request must carry the same nonce so Next stamps its
    // own script tags with exactly this value (browser-side enforcement).
    expect(forwardedRequestHeader(response, 'x-nonce')).toBe(nonce);
    expect(forwardedRequestHeader(response, 'content-security-policy')).toBe(csp);
  });

  it('production: every request gets a fresh nonce', async () => {
    const middleware = await loadMiddleware('production');
    const first = await middleware(makeRequest('/login'));
    const second = await middleware(makeRequest('/login'));
    expect(first.headers.get('content-security-policy')).not.toBe(
      second.headers.get('content-security-policy'),
    );
  });

  it('development: keeps unsafe-inline/unsafe-eval for HMR', async () => {
    const middleware = await loadMiddleware('development');
    const response = await middleware(makeRequest('/login'));
    const scriptSrc = scriptSrcOf(response.headers.get('content-security-policy')!);
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain('nonce-');
  });

  it('static policy directives are unchanged in both environments', async () => {
    for (const env of ['production', 'development'] as const) {
      const middleware = await loadMiddleware(env);
      const response = await middleware(makeRequest('/login'));
      const csp = response.headers.get('content-security-policy')!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("connect-src 'self'");
    }
  });
});

describe('middleware fencing (regression)', () => {
  it('strips client-supplied identity headers from the forwarded request', async () => {
    const middleware = await loadMiddleware('production');
    const response = await middleware(
      makeRequest('/login', {
        headers: {
          'x-user-id': 'attacker',
          'x-tenant-id': 'attacker-tenant',
          'x-user-role': 'SUPER_ADMIN',
        },
      }),
    );
    // The delete loop mutates the forwarded request in place (Next does not
    // serialise deletions into the override list), so the observable contract
    // is: the ONLY request headers the middleware (re)injects are the CSP and
    // the nonce — no identity header can ride along.
    const overridden = (response.headers.get('x-middleware-override-headers') ?? '')
      .split(',')
      .filter(Boolean)
      .sort();
    expect(overridden).toEqual(['content-security-policy', 'x-nonce']);
    for (const header of ['x-user-id', 'x-tenant-id', 'x-user-role']) {
      expect(forwardedRequestHeader(response, header)).toBeNull();
    }
  });

  it('public paths pass through without a session', async () => {
    const middleware = await loadMiddleware('production');
    for (const path of ['/login', '/forgot-password', '/signup', '/api/auth/login', '/api/health']) {
      const response = await middleware(makeRequest(path));
      expect(response.status, path).toBe(200);
    }
  });

  it('cron endpoints pass through without a session cookie', async () => {
    const middleware = await loadMiddleware('production');
    const response = await middleware(makeRequest('/api/cron/daily-digest'));
    expect(response.status).toBe(200);
  });

  it('protected pages redirect to /login without a session', async () => {
    const middleware = await loadMiddleware('production');
    const response = await middleware(makeRequest('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(response.headers.get('location')).toContain('redirect=%2Fdashboard');
  });

  it('APIs require a verifiable access token, not merely a cookie', async () => {
    // Regression for audit 07 M-2. The edge used to test only
    // `cookies.has('accessToken')`, so `Cookie: accessToken=x` reached every
    // business handler and the whole API's safety rested on each handler
    // remembering to call a guard. Signature/expiry are now checked here; the
    // per-request handlers remain authoritative for blacklist + tenant state.
    const middleware = await loadMiddleware('production');
    const anonymous = await middleware(makeRequest('/api/members'));
    expect(anonymous.status).toBe(401);
    const garbageToken = await middleware(
      makeRequest('/api/members', { headers: { cookie: 'accessToken=fake' } }),
    );
    expect(garbageToken.status).toBe(401);
    expect(await garbageToken.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects cross-site state-changing requests (CSRF)', async () => {
    const middleware = await loadMiddleware('production');
    const response = await middleware(
      makeRequest('/api/members', {
        method: 'POST',
        headers: { cookie: 'accessToken=fake', origin: 'http://evil.example.com' },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'CSRF_BLOCKED' });
  });
});
