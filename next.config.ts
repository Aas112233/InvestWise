import type { NextConfig } from "next";

// CSP moved to middleware.ts (audit F-1, 2026-10-13): the production policy is
// per-request nonce + 'strict-dynamic' (script-src 'self' 'nonce-…'
// 'strict-dynamic', no 'unsafe-inline'). A nonce cannot be a static header —
// it must differ per request — and Next only stamps its script tags when the
// policy arrives on the forwarded request, which only middleware can do.
// Development keeps 'unsafe-inline' + 'unsafe-eval' for Turbopack HMR. The
// remaining security headers are static and stay here.

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // postgres/bcryptjs stay external: bundling the DB driver into every
  // serverless function inflates cold starts (DATA-025). Same for exceljs and
  // pdfkit — the report builders pull in large CJS trees that change rarely.
  serverExternalPackages: ['postgres', 'bcryptjs', 'exceljs', 'pdfkit'],
  // Report PDFs embed per-locale Noto fonts read from disk at request time.
  outputFileTracingIncludes: {
    '/api/reports/generate/[type]': ['./lib/reports/fonts/**/*'],
  },
  experimental: {
    // lucide-react + recharts ship per-module code; barrel imports without
    // this optimization bloat the client bundle.
    optimizePackageImports: ['lucide-react', 'recharts'],
    // Security advisory upgrade policy for coding agents ('security' | 'latest'
    // | 'experimental-future' | false). 'security' keeps agents on the
    // advisory-driven upgrade track only.
    agentUpgrade: 'security',
  },
  // Baseline security headers. Applied to every route (API responses included)
  // so a browser cannot be tricked into framing, MIME-sniffing, or leaking the
  // origin via Referer. CSP is NOT here — it is per-request (nonce) and lives
  // in middleware.ts; two CSP headers would intersect into something stricter
  // than either policy intends.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS is honoured only over HTTPS; harmless on local http.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
