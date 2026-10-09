import type { NextConfig } from "next";

// Turbopack/HMR compiles and evaluates modules in the browser via eval, so
// development cannot boot without 'unsafe-eval'. The production runtime never
// needs it, so it is dropped from the shipped policy.
const isDev = process.env.NODE_ENV === "development";

// TODO(security): replace 'unsafe-inline' with the Next.js 15 middleware nonce
// pattern (middleware generates a per-request nonce, forwards the CSP header on
// the request so Next stamps its scripts, and echoes the policy on the
// response). Not adopted in this pass because it forces every page onto dynamic
// rendering and silently breaks any non-Next inline script or inline event
// handler — adoption needs a full browser pass over all screens on a production
// build, not just a boot check.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

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
  },
  // Baseline security headers. Applied to every route (API responses included)
  // so a browser cannot be tricked into framing, MIME-sniffing, or leaking the
  // origin via Referer. CSP is intentionally conservative and allows only what
  // the app actually uses (Next inline runtime, same-origin API, data: images).
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
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
