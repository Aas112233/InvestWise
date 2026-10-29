# 07 — Security Audit (Full Codebase)

**Date:** 2026-10-23
**Scope:** All 106 API routes under `app/api/**`, auth/session stack (`lib/`, `server/src/lib/`, `server/src/middleware/`), middleware, configuration, dependencies, logging. Static code audit (four parallel domain deep-dives: auth/session, access control/tenant isolation, injection/XSS/validation, config/secrets/deps), with every Medium finding re-verified first-hand in source before publication.
**Method:** OWASP Top 10 + API security checklist, route-by-route guard coverage (per HTTP method, not per file).

## Verdict

**No Critical or High findings. 6 Medium, 12 Low, 11 Informational.**

> **REMEDIATION LOG — 2026-10-23 (same day):** All 6 Medium and all 12 Low findings were fixed and verified (typecheck 0 errors, lint 0 errors/0 new warnings, vitest 517/517 green, live-DB check that the L-8 guard locks out no existing SuperAdmin). Deferred by decision: `.mcp.json` Supabase project ref (functional MCP config, public identifier — not a credential), jose consolidation, Sentry, HSTS preload, multi-region, and the remaining L-11 incremental Zod migration (meetings/goals/penalties validation hardening already landed). Details of each fix are inline in the finding entries below and in the remediation table at the bottom.

The security architecture is fundamentally sound — this is not a "vibecoded" app. Multi-tenant isolation is enforced server-side on every business route with compound `and(eq(id), eq(tenantId))` predicates, the JWT carries no authorization claims (identity is resolved from the DB per request), all SQL is parameterized with whitelisted dynamic ORDER BY, and the production dependency tree has **zero known vulnerabilities**. The findings below are hardening items, not structural holes.

---

## Medium Findings

### M-1. `JWT_SECRET` accepts any length — weak production secret silently valid
- **Where:** `lib/utils/jwt.ts:45-49` (also `:62-65`)
- **Evidence:** `getSecret()` checks only presence (`if (!jwtSecret) throw`) for the access secret. The refresh secret path requires ≥16 chars (`:36`); the access secret path has no floor.
- **Impact:** HS256 with a short secret is brute-forced offline from any captured token → full session forgery, any role, any tenant. A 1-character prod secret deploys without warning.
- **Fix:** Reject `< 32` chars fail-closed in `getSecret()` and `generateAccessToken()` (mirrors the existing refresh-secret floor).

### M-2. Refresh-token reuse detected but the session family is not revoked
- **Where:** `app/api/auth/refresh/route.ts:85-87` (blacklist hit) and `:151-153` (unique-constraint 23505 hit)
- **Evidence:** Both reuse branches throw `TOKEN_REVOKED` and nothing else. Rotation itself is excellent (new `sessionId`, old token hash-blacklisted, session row re-keyed — `:124-148`), but reuse is theft evidence and should kill the chain.
- **Impact:** An attacker who steals a refresh cookie and rotates first keeps a live session (up to the 35m-idle/24h-absolute caps); the *victim* is the one locked out.
- **Fix:** In both reuse branches, additionally `UPDATE sessions SET isActive=false, isExpired=true WHERE sessionId = decoded.sessionId` (and any row re-keyed from it for that user's login family).

### M-3. Systemic `err.message` passthrough leaks SQL/driver text on 500s
- **Where:** ~90 route files use `{ message: err.message || '…' }` with `status: err.statusCode || 500`. Representative: `app/api/deposits/route.ts:274`, `app/api/reports/export-generic/route.ts:61`, `app/api/analytics/stats/route.ts:399`.
- **Evidence:** For non-`AppError` failures (DB exceptions), Drizzle wraps postgres.js errors as `"Failed query: <SQL text>"` — the raw SQL reaches the client body. The codebase already has the correct pattern (`server/src/middleware/api.ts:95-116` `errorResponse` masks unknown 5xx; `app/api/reports/generate/[type]/route.ts:275-283` cites §11) but most App Router routes don't use it.
- **Impact:** Authenticated users can trigger unexpected errors (oversized values, type mismatches, constraint violations) and read schema/query structure.
- **Fix:** Route every catch through a shared helper: `err.message` only for `AppError`/`statusCode`-carrying errors; static message + logged detail otherwise. One shared fix, largest blast radius of the report.

### M-4. CSV formula injection in exports (+ missing permission gate on export-generic)
- **Where:** `app/api/reports/export-generic/route.ts:9-24` (`convertToCsv` escapes quotes only), `lib/reports/csv.ts:7-9` (same gap)
- **Evidence:** Cells beginning `=`, `+`, `-`, `@` pass through verbatim. `export-generic` requires only `getAuthContext` — any authenticated Member can POST arbitrary JSON rows into a downloaded CSV.
- **Impact:** A member name / note / reference like `=WEBSERVICE(...)` becomes a live formula in a finance officer's Excel (data exfiltration channel). No cross-tenant leak (data is client-supplied or tenant-own).
- **Fix:** Prefix `'` on cells starting with `=`, `+`, `-`, `@` (or tab) in both CSV builders; add a `REPORTS READ` permission floor on export-generic.

### M-5. Goals money fields stored via float `Number()` coercion
- **Where:** `app/api/goals/route.ts:113-114`, `app/api/goals/[id]/route.ts:105-126`
- **Evidence:** `targetAmount: String(Number(targetAmount))` with only presence validation (`:92`).
- **Impact:** `Number("abc")` → `"NaN"` → Postgres numeric cast error (a 500 that leaks driver text via M-3); `1e21`-scale inputs lose precision; violates the project's own §12 integer-cents rule used everywhere else. Goals are savings targets, not ledger rows — hence Medium not High.
- **Fix:** Parse via `parsePositiveAmount`/`toCents` (`lib/money.ts`) and store decimal strings, matching the finance core.

### M-6. Governance penalties: unvalidated `deductionAmount` + float percentage math
- **Where:** `app/api/governance/penalties/route.ts:125` (raw destructure, no type/range check), `:190-196` (`Math.round(x * pct / 100 * 100) / 100` float math), `:236`
- **Impact:** A string, negative, or `NaN` deduction reaches DB math; percentage rounding can drift by cents. Inconsistent with the cents-based finance core.
- **Fix:** Zod schema (positive decimal string ≤ MAX_AMOUNT) + `toCents` computation.

---

## Low Findings

| # | Finding | Where | Fix |
|---|---|---|---|
| L-1 | Delegated money-API identity cache TTL is 60s (modern stack: 10s) — a suspended/demoted officer keeps writing to `/api/finance/*` for up to 60s | `server/src/lib/session.ts:33,166` vs `lib/middleware/auth.ts:34` | Drop to ≤10s or cache-bust on `users.updatedAt` |
| L-2 | Logout with an expired access token (common 15m state) clears cookies but never blacklists the refresh token or ends the session — user believes they logged out | `app/api/auth/logout/route.ts:15-27` | In the early-return branch, signature-verify the refresh cookie, blacklist it, deactivate its session |
| L-3 | A short (<16 char) explicit `JWT_REFRESH_SECRET` is silently ignored (derived fallback used) — misconfiguration masked | `lib/utils/jwt.ts:36-38` | Throw on explicit-but-weak config |
| L-4 | Delegated-stack JWT verify doesn't pin `algorithms: ['HS256']` (root stack does) | `server/src/lib/jwt.ts:35` | Add the pin to match `lib/utils/jwt.ts:102` |
| L-5 | Tracked `.wrangler/cache/wrangler-account.json` leaks Cloudflare account ID + owner email; `.mcp.json` leaks Supabase project ref (recon material, not credentials) | repo root | Untrack both, add `.wrangler/` to `.gitignore` |
| L-6 | `seed-superadmin.mjs` reset branch silently resets the operator password to the public dev default (`pass-12345678`) when `NODE_ENV` is unset — a non-prod-mislabel run against a prod DB compromises the platform account | `scripts/seed-superadmin.mjs:26,49,55` | Require an explicit confirmation flag on the reset path |
| L-7 | Edge middleware skips auth/subscription/admin fencing for any dotted path (`/admin/x.html`); handlers re-verify authoritatively, so edge-fencing bypass only | `middleware.ts:110` | Restrict dot-bypass to known static extensions |
| L-8 | `requireSuperAdmin` doesn't require null `tenantId` — a DB-edited SuperAdmin row with tenant context would pass platform gates (no code path creates one today) | `lib/admin-guard.ts:7-14` | Also require `!user.tenantId` |
| L-9 | Terminal UPDATE/DELETE predicates use bare `eq(id)` after a tenant-scoped fetch — safe today, defense-in-depth gap under refactor | `app/api/members/[id]/route.ts:184,206`; same pattern in finance service post-lock writes | Add `eq(tenantId)` to terminal where-clauses |
| L-10 | LIKE wildcard injection: client `%`/`_` act as wildcards in search filters (parameterized — not SQLi) | `server/src/modules/finance/service.ts:310-370`, `app/api/auth/users/route.ts:123` | Escape `%`/`_` or accept as Info |
| L-11 | 36 body-reading routes validate manually instead of `validateBody`+Zod — unbounded string lengths, per-field drift (goals/penalties M-5/M-6 are the concrete failures) | e.g. `app/api/meetings/route.ts:108-113`, `app/api/admin/**` | Incrementally migrate to the module-handler pattern |
| L-12 | `updateFund(id, data, tenantId?)` — tenant scope applied only if the arg is passed (sole caller always passes it) | `server/src/modules/funds/service.ts:218-221` | Make `tenantId` required |

## Informational

- **Public signup mints tenant + Admin account** while the operator flag is on (`app/api/auth/signup/route.ts:201,320`) — intended product behavior; gated by Turnstile posture, per-IP/per-email/global-ceiling limits; trial-farming risk if left on with CAPTCHA off.
- **No self-service password reset exists** — forgot-password only rate-limits + audit-logs for manual operator recovery (`app/api/auth/forgot-password/route.ts:10-16`). Structurally eliminates the reset-token risk class; availability trade-off.
- **Dependency advisories are dev-only** (vite launch-editor, vitest mock injection — never shipped). Production tree: 0 vulnerabilities. `xlsx` is absent (unmaintained-SheetJS risk does not apply).
- **Dual JWT libraries** (`jsonwebtoken` Node + `jose` edge) — maintained, but two verification paths can drift; consolidate on `jose` eventually.
- **No external error tracking** (Sentry/OTel) — Vercel `console.error` only. Monitoring gap, not a vuln.
- **Single region `sin1`** (`vercel.json`) — availability consideration.
- **HSTS lacks `preload`** (`next.config.ts:46`).
- **Admin diagnostics expose Postgres/Node version strings** — SuperAdmin-only, acceptable.
- **Legacy `server/` Express dir** carries older deps (`drizzle ^0.38`, `zod ^3`) — confirm not deployed anywhere before ignoring.
- **Analytics casts to `::float`** for display only — nothing stored as float.
- **Platform operator (null tenant) sees the cross-tenant user directory** (`app/api/auth/users/route.ts:81`) — intended operator feature; PII concentration noted.

---

## What Is Done Well (verified)

1. **Zero unguarded routes.** All 106 routes audited per HTTP method: 61 modern stack, 20 delegated module handlers, 15 SuperAdmin admin console, 6 projects helper, 2 CRON_SECRET, 5 intentionally public (health/login/refresh/signup/forgot-password).
2. **Tenant identity is never client-supplied.** `tenantId`/`role` resolve from per-request DB lookups on both stacks; the JWT carries only `{id, sessionId, type}`; the historical `x-user-*` header-trust branch was already excised (`lib/middleware/auth.ts:567-571`); the edge strips spoofed identity headers (`middleware.ts:88-91`).
3. **No SQL injection surface.** Zero `sql.raw`; all 27 `db.execute` sites use parameterized template tags; dynamic ORDER BY maps through fixed column whitelists everywhere; a repo test (`sqlcap.test.mts`) pins parameterization.
4. **No XSS sinks.** Zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`; print documents are React components with compile-time `kind` unions; CSP is nonce + `strict-dynamic` with no `unsafe-inline` scripts in production; full static header suite (nosniff, DENY, Referrer-Policy, Permissions-Policy, HSTS).
5. **Token lifecycle is genuinely hardened.** Rotation re-keys the session identity (not just the token); refresh tokens stored/compared as sha256 hashes; blacklist + session-activity checked on every request; 35m idle + 24h absolute caps; impersonation sessions time-capped and audit-logged.
6. **Abuse controls are serverless-correct.** Postgres-backed atomic rate buckets that fail closed; login lockout with reason capture; timing-equalized login (no user enumeration); Turnstile verified server-side; signup has a global ceiling that auto-tightens without CAPTCHA.
7. **Money core integrity.** Integer-cents arithmetic with 2-dp regex and MAX caps, `FOR UPDATE` row locks in canonical order, `pg_advisory_xact_lock`, idempotency keys on long runs, share-value lock, one-way project lock.
8. **Audit trail breadth.** 55 tenant-scoped `logAudit` sites + 15 SuperAdmin action-log sites including impersonation start/stop, with actor and before/after snapshots; failed logins recorded with IP/UA/geo.
9. **Fail-closed posture throughout.** Unset `CRON_SECRET` → 403; missing tenant row → deny; unreachable rate counter → deny; suspended user/tenant rejected on both stacks; backups/restore endpoints fail honestly (501) rather than pretend.
10. **Least-privilege defaults.** Member baseline is read-only + deposit requests; deposit approval requires `DEPOSITS WRITE`; Manager excluded from SETTINGS; platform operators rejected from tenant business routes (`403 PLATFORM_USE_ADMIN_API`) and must use audited impersonation instead.

---

## Remediation Priority

| Order | Item | Effort |
|---|---|---|
| 1 | M-1 JWT secret min-length (one guard, catastrophic-if-hit) | XS |
| 2 | M-3 shared error-masking helper (~90 routes adopt it) | M |
| 3 | M-2 session-family revocation on refresh reuse | S |
| 4 | M-4 CSV formula neutralization (2 files) + permission gate | XS |
| 5 | M-5/M-6 goals + penalties cents parsing (3 files) | S |
| 6 | L-1…L-12 hardening batch (cache TTL, logout blacklist, repo hygiene, defense-in-depth predicates) | M |

## Remediation Detail (applied 2026-10-23)

| Finding | Fix applied | Where |
|---|---|---|
| M-1 | `JWT_SECRET` must be ≥32 chars, fail-closed at sign AND verify (`requireSecret`); `generateAccessToken` routes through `getSecret('access')` | `lib/utils/jwt.ts` |
| M-2 | Refresh-token reuse (blacklist hit, session-row miss, or 23505 replay) now revokes every active session for the user (`revokeUserSessionFamily`) — stolen-cookie rotation chains die at detection | `app/api/auth/refresh/route.ts` |
| M-3 | New `apiError(err, fallback)` helper masks non-operational 500s (static message + `[API_ERROR_MASKED]` log; AppError/4xx pass through verbatim per §11); 60 catch blocks rewritten across 45 route files via codemod (4 remaining passthroughs are `instanceof AppError`-guarded — safe) | `lib/utils/api-error.ts` + app/api/** |
| M-4 | `neutralizeCsvFormula` (prefixes `'` on `= + - @` tab CR, keeps plain negative numbers) applied in both CSV builders; `REPORTS READ` permission floor on export-generic | `lib/reports/csv.ts`, `app/api/reports/export-generic/route.ts` |
| M-5 | Goals amounts parsed via `parsePositiveAmount`/`toCents`/`fromCents` (POST + PUT + completion comparison in cents); title capped at 200; `MoneyError` → 400 | `app/api/goals/route.ts`, `app/api/goals/[id]/route.ts` |
| M-6 | Penalty `deductionAmount` validated (decimal, ≥0, ≤ ceiling; percent ≤100), tier integer 1-10, reason/title caps; percentage math in integer cents (`roundToCents`); member debit stays decimal-string parameter; `MoneyError` → 400 | `app/api/governance/penalties/route.ts` |
| L-1 | Delegated identity cache TTL 60s → 10s (matches modern stack) | `server/src/lib/session.ts` |
| L-2 | Logout with expired/absent access token now signature-verifies the refresh cookie, blacklists it, and ends its session (scoped to the token's own user) | `app/api/auth/logout/route.ts` |
| L-3 | Explicit-but-short `JWT_REFRESH_SECRET` now throws instead of silently using the derived secret | `lib/utils/jwt.ts` |
| L-4 | Delegated verify pins `algorithms: ['HS256']` | `server/src/lib/jwt.ts` |
| L-5 | `.wrangler/` untracked + gitignored (account ID + owner email leak). `.mcp.json` kept: the Supabase `project_ref` is a functional, public identifier, not a credential | `.gitignore`, git index |
| L-6 | Existing-superadmin password reset requires `--reset-password` (or `SEED_RESET_PASSWORD=1`); re-seeds no longer rewrite credentials silently | `scripts/seed-superadmin.mjs` |
| L-7 | Edge dot-bypass restricted to known static extensions (`STATIC_ASSET_RE`) — `/admin/x.html`-style dotted app paths are fenced again | `middleware.ts` |
| L-8 | `requireSuperAdmin` additionally requires null `tenantId` (verified against live DB: both SuperAdmin rows are NULL — no lockout) | `lib/admin-guard.ts` |
| L-9 | Tenant predicate added to 13 terminal writes that previously trusted a tenant-scoped fetch (3 in members/[id], 10 finance-service post-lock balance writes) | `app/api/members/[id]/route.ts`, `server/src/modules/finance/service.ts` |
| L-10 | New `escapeLikePattern` helper (escapes `\ % _`); applied at 30 search-filter sites across 10 files | `lib/utils/validation.ts` + app/api/**, finance service |
| L-11 | Targeted: meetings POST full shape validation (string caps, valid date); goals title + penalties reason/title caps landed with M-5/M-6. Remaining manual-validation routes still migrate incrementally to `validateBody`+Zod | `app/api/meetings/route.ts` et al. |
| L-12 | `updateFund(id, data, tenantId, user)` — tenantId now required, query always tenant-scoped | `server/src/modules/funds/service.ts` |

**Known behavioral changes:** (1) refresh-token reuse now logs the user out everywhere — a second tab racing a rotation loses both sessions (deliberate: theft evidence); (2) unexpected 500s return a static fallback message instead of raw driver text — check server logs for `[API_ERROR_MASKED]` when debugging; (3) `db:seed` re-runs no longer reset an existing superadmin password; (4) CSV cells beginning `= + - @` gain a leading apostrophe in exports.

**Pre-existing context:** fixes from the 2026-10-13 audit (`01-security-auth.md`) were re-verified present: CSP nonce propagation, cache TTL bounds, backup DoS-amplifier removal, constant-time secret comparisons.
