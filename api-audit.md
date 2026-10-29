
---

## 4. Authentication & authorization

### H-1 · `Auditor` (documented read-only) can write money — **HIGH**

`lib/roles.ts:64-70` gives `Auditor` a `READ` baseline on every screen. Five mutating handlers never consult it:

```ts
// app/api/meetings/route.ts:102            (also PUT /meetings/[id]:97,
//                                           /complete:48, /attendance:24)
if (normalizeRole(user.role) === 'Member') {
  throw new ForbiddenError('Insufficient permissions to schedule meetings');
}
// app/api/governance/penalties/route.ts:119
if (normalizeRole(user.role) === 'Member') {
  throw new ForbiddenError('Insufficient permissions to issue penalties');
}
```

An `Auditor` calls `POST /api/governance/penalties` with a `deductionAmount` → the penalty debits `members.totalContributed`. A read-only account moves money. `MEETINGS` and `GOVERNANCE` are first-class screens in `ALL_SCREENS` (`lib/middleware/auth.ts:137-141`) but are never checked on these paths. `/attendance` also increments `members.warningCount` (`:124-131`), which feeds the suspension engine.

**Fix (one line each):** `if (!hasScreenPermission(user, 'MEETINGS', 'WRITE')) throw new ForbiddenError(...)`, and `'GOVERNANCE'` for penalties.

### H-2 · Missing screen gates on live read endpoints — **HIGH**

| Endpoint | Now | Should be |
|---|---|---|
| `GET /api/transactions` | auth + tenant only | `hasScreenPermission(user,'TRANSACTIONS','READ')` |
| `GET /api/reports/generate/[type]` (`:54-59`) | auth + tenant only | `hasScreenPermission(user,'REPORTS','READ')` — the dead `export-generic:41` is the only place that gate exists |
| `GET /api/fiscal/years` | any authenticated user | intentional (year picker) — acceptable, document it |

### M-1 · Edge skips **all** fencing for any path containing a dot — **MEDIUM**

```ts
// middleware.ts:106-113
if (pathname.startsWith('/_next') || pathname.startsWith('/static')
    || pathname.startsWith('/favicon') || pathname.includes('.')) {
  return forward();
}
```
This `return` sits **above** the CSRF Origin check (`:126`), `PUBLIC_PATHS` (`:115`), the `/api/*` cookie check (`:145`) and the `/admin` platform redirect (`:178`). So `POST /api/deposits.request`-style dotted paths, `/api/admin/diagnostics.x`, and `/admin/anything.yaml` clear the edge with no CSRF check and no admin redirect. Next matches dynamic segments to dotted values, so `/api/members/1.2` still resolves to `[id]`. Handlers still authenticate, so this is a removed defense-in-depth layer today — and a live CSRF gap — rather than a bypass.

**Fix:** replace the broad dot test with an extension allowlist: `/\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|txt|xml|webmanifest)$/i`.

### M-2 · APIs authenticate on cookie *presence*, not validity — **MEDIUM**

```ts
// middleware.ts:144-148
if (pathname.startsWith('/api/')) {
  if (request.cookies.has(ACCESS_COOKIE)) return forward();
```
`Cookie: accessToken=x` reaches every business handler; safety depends entirely on each handler remembering a guard. This is the most likely origin of the "unauthenticated APIs" impression. `verifyEdgeAccessToken` is **already imported** in this file — run it here too and require non-null claims. Handlers stay authoritative for revocation.

### M-3 · `GET /api/backup` is unthrottled bulk PII export — **MEDIUM**

`app/api/backup/route.ts:16-28` runs `SELECT * FROM <t> WHERE tenant_id = $1` across 7 tables including `members` (PII) and `audit_logs`, with no `LIMIT`, no rate limit and no step-up. Correctly tenant-scoped and audited (`EXPORT_BACKUP:106`), but one stolen tenant-Admin session yields complete customer-data exfiltration in a single request. **Fix:** step-up re-auth, per-tenant limit, drop `audit_logs` from the tenant slice.

### M-4 · `POST /api/backup` (cron) is unreachable — and one "fix" from becoming unauthenticated — **MEDIUM**

It is guarded by `CRON_SECRET` (`:44-50`) but sits at `/api/backup`, **not** under `/api/cron/`, so `middleware.ts:140-142` does not bypass it and `:145` demands an `accessToken` cookie first. A scheduler presenting only `Authorization: Bearer $CRON_SECRET` is rejected at the edge. Fails **closed** (no weakness), but the documented contract is broken — and the obvious "fix" of adding `/api/backup` to `PUBLIC_PATHS` would create a genuinely unauthenticated endpoint. **Move it to `/api/cron/backup`.**

### L-1 · Impersonation exit restores an operator session from a cookie-borne credential — **LOW**

```ts
// app/api/admin/impersonate/route.ts:186-188
// Exit path requires no body and no admin auth ...
if (!token && stashed) {   // :233-247 restores access+refresh from the cookie
```
`impersonationAdminSession` carries the platform admin's **raw tokens** in a cookie held by the impersonated tenant's browser; restore trusts it with no server-side record. `httpOnly` blocks JS reads, but cookie-tossing from a sibling subdomain or a copied profile yields a valid operator session. It does correctly revoke the impersonation session first (`:195-203`). **Fix:** store the pair server-side, keyed by an opaque id.

Entry is otherwise solid: `requireAuthUser` + `requireSuperAdmin` (`:87-88`), 30-min token bound to a real `sessions` row, cannot target an operator (`superadmin-service.ts:631-633`), audited on start and end.

### L-2 · `isPlatformEdge()` treats impersonation as platform — **LOW**

`lib/edge-auth.ts:38-44` ORs in `!!claims.impersonatedBy`, so an impersonated tenant Admin can load `/admin*` pages. Data stays blocked (stack C re-checks the DB role), but a fake admin console renders at the real origin — phishing surface. Drop that term.

### L-3 / L-4 · Low-severity disclosures
- `/api/admin/diagnostics` (SuperAdmin-only, correctly guarded) returns raw `version()`, Node version, uptime and platform-wide row counts — precise fingerprinting for any operator-session holder. Gate behind `?verbose=1`.
- `/api/auth/users:73-81` — `const scope = tenantId ? eq(users.tenantId, tenantId) : undefined` gives a `tenantId: null` caller a cross-tenant directory without `requireSuperAdmin`. The only cross-tenant read outside `/api/admin/*`.

### Verified correct (so coverage is provable)
- **No guard-less handler.** Every one of the 106 terminates in `getAuthContext` / `requireAuthUser` / `requireSession` / `requirePermission` / `authorizeCronRequest`. `server/src/lib/session.ts:61-105` re-verifies JWT, `sessionId` presence, sha256 blacklist, active-session, absolute + idle expiry, with no default-user fallback.
- **`PUBLIC_PATHS` matching is not exploitable** — the `path + '/'` form prevents `/api/auth/login-history` from matching `/api/auth/login`. `/api/auth/register` is correctly absent. (Normalization reasoning is from framework semantics, not runtime-tested — **UNVERIFIED**.)
- **No header trust.** Zero `.ts` files read `x-user-id` / `x-tenant-id` / `x-user-role`; `middleware.ts:88-91` strips all seven.
- **No client-supplied `tenantId` reaches a tenant query.** The two `searchParams.get('tenantId')` sites are both SuperAdmin-only filters (`admin/action-log:20`, `admin/users:35`).
- **All 15 `/api/admin/**` files** call `requireSuperAdmin` in every handler; tenant `Admin` cannot reach any of them (`isSuperAdminRole` compares only to `'SuperAdmin'`, and both token-minting paths reject allowlisted emails).
- **CSRF**: state-changing methods are Origin-checked (`:126`); CSP nonce + `strict-dynamic` in production (`:29-44`).
- **Cron** fails closed with a timing-safe compare when `CRON_SECRET` is unset (`lib/cron-auth.ts:22-38`).
- **No SuperAdmin can be minted from request input** on any registration path.
- Deposits/payouts/members/projects/audit/fiscal/dividends/settings: tenant scoping + screen permissions present and correct.

---

## 5. Rate limiting

The primitive is **good**: `lib/rate-limit.ts` is Postgres-backed (correct for serverless), atomic (`INSERT … ON CONFLICT DO UPDATE … RETURNING`, `:55-68`), hashes identity into the key, computes `retryAfterSec`, and **throws so callers must deny** — the docblock says it plainly: *"a throttle that fails open is not a control, it is a log."*

It is wired into **7 of 106 routes**.

### Every limiter that exists

| Scope key | Limit / window | Dimension | Route |
|---|---|---|---|
| `login:ip` | 30 / 15 min (60 if unknown) | IP | `auth/login:146-150` |
| *email lockout* | 5 failures / 15 min | email | `auth/login:205,216` (`login_attempts`, 423) |
| `signup:ip` | 5 / 15 min | IP | `auth/signup:227` |
| `signup:email` | 3 / 30 min | email | `auth/signup:279` |
| `signup:global` | ceiling / 1 h | **platform-wide** | `auth/signup:307` |
| `forgot:ip` | 5 / 15 min | IP | `auth/forgot-password:48-52` |
| `forgot:email` | 3 / 60 min | email | `auth/forgot-password:70-74` |
| `bulk-deposit:user` / `:tenant` | 12 / 60 s · 60 / 60 s | tenant+user / tenant | `finance/handlers.ts:70-75` |
| `deposit-month-status:user` / `:tenant` | 60 / 60 s · 300 / 60 s | tenant+user / tenant | `finance/handlers.ts:70-75` |

All fail **closed** and return 429 + `Retry-After`. `bulk-deposit` and `month-status` are the model: two dimensions (user *and* tenant) so one clerk cannot multiply the ceiling. **No bucket is shared across tenants** except `signup:global`, which is deliberate.

### R-1 · The IP key is probably client-controlled — **HIGH**

```ts
// lib/request-meta.ts:28-36
export function getAbuseClientIp(request) {
  return request.headers.get('x-real-ip') ||            // ← tried FIRST
         request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-vercel-forwarded-for')?.split(',')[0] ||
         request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
}
```
The docblock claims *"the spoofable header last"* and *"headers a platform edge stamps on the request win"* — but `x-real-ip` is read first, and Vercel stamps `x-vercel-forwarded-for`, not `x-real-ip`. If Vercel forwards a client-supplied `x-real-ip` (the default for arbitrary headers), **every IP bucket is bypassable with one header**, and each spoof spawns a new `rate_limit_buckets` row — turning the control into the storage problem `lib/rate-limit.ts:83-87` warns about. `signup` survives via email + Turnstile + global ceiling; **login and forgot-password have no second independent dimension**.

**Fix:** trust `x-vercel-forwarded-for` only, and add `x-real-ip`, `cf-connecting-ip`, `x-forwarded-for` to the strip-list at `middleware.ts:89`. **Verify on a preview deploy:** `curl -H "x-real-ip: 1.2.3.4" …/api/auth/login`. Until this ships, no IP limit here can honestly be described as working.

### R-2 · Unauthenticated endpoints with no limiter

- **`POST /api/auth/refresh` — HIGH.** Public at the edge (`middleware.ts:75`), zero throttling. Per call: 2 parallel SELECTs (`sessions ⋈ blacklisted_tokens` + `users`), a `blacklisted_tokens` **INSERT**, a `sessions` **UPDATE**, subscription lookup, and 2 minted JWTs (`refresh/route.ts:65-97, 154-209`). A concurrent loop burns ~6 round-trips per request and grows `blacklisted_tokens` without bound. Recommend `refresh:ip` 30/min, `refresh:session` 10/min.
- **`GET /api/health` — MEDIUM.** `force-dynamic`, no DB, but every hit is a billable invocation/cold start, with no throttle, no `Cache-Control`, and no WAF. Recommend 120/min/IP.
- **`/api/cron/*` — LOW/MEDIUM.** Secret-gated and fails closed, but *unlimited attempts* against a shared bearer with a 300-second job behind it. Recommend 10 attempts/hour/IP.
- `forgot-password` has no **global** ceiling → rotating IPs write unbounded `audit_logs`.

### R-3 · Expensive authenticated endpoints with no limiter — the real gap

| Endpoint | Per-request cost |
|---|---|
| `GET /api/backup` | 7 sequential unbounded `SELECT *`, fully materialised then `JSON.stringify`'d — hundreds of MB for a large tenant |
| `POST /api/members/recalculate-financials` | 3 full-tenant `transactions` aggregates with **no date bound**, then an `UPDATE … FROM (VALUES …)` with one row per drifted member. **No `maxDuration`** → dies mid-write at the 10 s default |
| `GET /api/analytics/stats` | **13 parallel queries**, six unbounded all-time aggregates — called on every dashboard load |
| `GET /api/analytics/analysis` | 5 parallel queries; all-time sums plus every FY transaction loaded into memory, then an O(members × 12) matrix |
| `POST /api/dividends/calculate` | O(members) JS + full `memberBreakdown` array, read-only, no idempotency key |
| `GET /api/reports/generate/[type]` | `maxDuration = 60`, exceljs + jspdf + embedded Noto fonts, 5 000-row cap. Row cap good, **frequency unlimited** |
| `POST /api/reports/export-generic` | unbounded `readJsonBody`, `data` array length **unvalidated** (`:48` checks only non-empty) → CPU/memory bomb |
| `POST /api/governance/performance/recalculate-all` | `maxDuration = 300`, Admin-only, unlimited → one Admin holding F5 pins a function 5 min per request |
| `POST /api/deposits/request/bulk` | `MAX_BATCH = 100` ✅ but no rate limit, no body cap, and `Promise.all` of **100 concurrent `logAudit` statements** |

Amplifier: all of these route through `getAuthContext`, which does a per-request user + tenant + subscription load, so a loop multiplies identity queries too.

### R-4 · Clamps and body size

- **`limit` is clamped everywhere** (100 default, 200 funds, 500 deposits/projects/members). ✅ That part of the design holds.
- **`page` is never bounded** — `server/src/middleware/api.ts:384`, `lib/utils/types.ts:26`, `app/api/projects/route.ts:37`, `app/api/deposits/route.ts:46` all allow `page=1000000` → unbounded `OFFSET` that Postgres still walks. **MEDIUM.**
- `GET /api/audit` `search` runs `details::text ILIKE '%…%'` (`:85`) — unindexed tenant-wide scan; `startDate`/`endDate` are `new Date(str)` with no shape validation (`:75,80`) → `Invalid Date` → 500.
- **Only 4 routes cap body size** (login 4 KB, signup 8 KB, forgot 4 KB, `finance/deposits/bulk` 256 KB). `validateBody` *supports* `maxBytes` but exactly one caller uses it. `readJsonBody` / `readJsonObject` (`lib/utils/errors.ts:98-137`) have **no cap**. `equityTransferSchema.transfers` is `z.array(...)` with **no `.max()`** (`validation.ts:160`). Vercel's ~4.5 MB limit is a ceiling, not a control.
- **Zero platform-level throttling:** `vercel.json` (16 lines) has no WAF, headers, or concurrency config; `middleware.ts` never counts; no rate-limit dependency.

### Recommended guard (one call per route, three profiles)

```ts
// lib/guarded-route.ts — wraps the existing primitive; adds no new store
const PROFILES = {
  auth:      { perIp: [10, 60],    perIdentity: [5, 300] },
  public:    { perIp: [120, 60] },
  expensive: { perUser: [30, 3600], perTenant: [120, 3600] },
  export:    { perUser: [20, 3600], perTenant: [60, 3600] },
} as const;
/** Spend every dimension; 429 + Retry-After, or 503 if the counter is unreachable. */
export async function guard(scope: keyof typeof PROFILES,
  id: { ip?: string; user?: string; tenant?: string }): Promise<void>;
```
Adopt on: `refresh` (`auth`), `health` (`public`), `analytics/*`, `dividends/calculate`, `recalculate-financials`, `recalculate-all`, `distribute*`, `projects` POST (`expensive`), `backup`, `reports/generate/[type]`, `export-generic` (`export`). Separately: clamp `page` and require `page * limit ≤ 100_000`; validate dates as `YYYY-MM-DD` with a ≤24-month span; `maxBytes` on every mutating route; `.max(5000)` on `export-generic.data`.

---

## 6. Remediation plan

**Phase 1 — small diffs, money integrity (do first)**
1. `hasScreenPermission` on the 5 `role !== 'Member'` handlers (H-1) and on `GET /api/transactions`, `GET /api/reports/generate/[type]` (H-2).
2. Fix `getAbuseClientIp` trust order + strip the three IP headers at the edge (R-1).
3. Narrow the `pathname.includes('.')` static-asset test (M-1); verify the JWT for `/api/*` at the edge (M-2).
4. Move the cron backup to `/api/cron/backup` (M-4).

**Phase 2 — close the duplicates (the actual complaint)**
5. Delete the 5 dead `/api/finance/deposits*` twins **after** porting `requestKey` idempotency + the rate-limit budget into `/api/deposits`. This removes the closed-period back door by removing the door.
6. Delete both `/api/finance/transactions*` twins and `/api/finance/expenses` + `/api/finance/transfer` (pure adapter) + `/api/finance/funds/[id]/reconcile`.
7. Wire or delete `PUT /api/finance/expenses/[id]` (the only expense-edit path).
8. Move member `status` out of `PUT /api/members/[id]` into the governance endpoint, keeping Admin-only + reason + audit.
9. Delete the remaining 9 dead endpoints in §3.7.

**Phase 3 — architecture so it cannot regrow**
10. One `requireAccess({ screen, level })`; delete the duplicate `requirePermission` name; fold stacks C and D into it as scopes.
11. One response envelope (the delegated tree's `{data, meta}` is missing `success`, violating §11); one `audit_logs` serializer; one ledger-write owner so `transactions` is not written from four places.
12. `guard()` on every expensive/export route (§5); add `assertFiscalPeriodOpen` to the fund-movement service functions.

**Suggested acceptance test:** a route-manifest test that fails the build if any `app/api/**/route.ts` lacks a session guard, a screen permission on every mutating method, and (for routes with `maxDuration`) a `guard()` call. That converts all three of your complaints into build errors rather than review findings.

---

## 7. Known-issue overlap

Prior audits exist in-repo (`analysis-module-audit.md`, `reports-module-audit.md`, `date-handling-audit.md`, `input-validation-audit.md`, `dead-code-audit.md`, `docs/audit/01-security-auth.md`, `docs/audit/07-security-audit.md`). `docs/audit/01-security-auth.md` already documents the stack-B session weakness referenced in §2. This report does **not** re-run those scopes; new ground here is the cross-stack guard-divergence table (§3), the R-1 IP-key trust order, and the edge fencing holes (M-1/M-2/M-4).

---

# Appendix A — Remediation applied (23-10-2026)

Verified with `npm run typecheck` (0 errors) and `npm test` (**517 passed / 517**, 48 files) and `npx eslint` clean on every touched file.

## A.1 Authorization (H-1, H-2) — read-only roles can no longer write money

Replaced the `role !== 'Member'` shortcut with the shared screen evaluator. `Auditor` (READ baseline, `lib/roles.ts:67`) is now actually blocked from these:

| Handler | Now requires |
|---|---|
| `POST /api/meetings` | `hasScreenPermission(user,'MEETINGS','WRITE')` |
| `PUT /api/meetings/[id]` | `MEETINGS` WRITE |
| `POST /api/meetings/[id]/complete` | `MEETINGS` WRITE |
| `POST /api/meetings/[id]/attendance` (drives `warningCount`) | `MEETINGS` WRITE |
| `POST /api/governance/penalties` (debits `totalContributed`) | `GOVERNANCE` WRITE |
| `POST /api/transactions` | `TRANSACTIONS` WRITE |
| `GET /api/transactions` | `hasAnyScreenPermission(['TRANSACTIONS','DEPOSITS','REQUEST_DEPOSIT'],'READ')` — mirrors the finance twin |
| `GET /api/reports/generate/[type]` | `hasScreenPermission(user,'REPORTS','READ')` |

Note: `hasScreenPermission` honours explicit per-user permission overrides and the `TRANSACTIONS←DEPOSITS` / `MEETINGS←MEMBERS` inheritance in `lib/permissions.ts`, so these gates respect the permission matrix rather than hard-coding roles. `goals/[id]` and `governance/members*` keep their `role === 'Member'` tests deliberately — those are per-row *ownership* scoping, not RBAC.

## A.2 Money integrity — the closed-period back door is closed

In `server/src/modules/finance/service.ts`, the delegated twins now enforce what the native handlers always did:

- `approveDeposit` — added `status === 'pending'` assertion, self-approval ban (`SELF_APPROVAL`), and `assertFiscalPeriodOpen`. Previously it could credit settled money into a **locked fiscal year**, re-approve a `REJECTED` row, and let an officer approve their own request.
- `revertDeposit`, `deleteTransaction`, `addExpense` — each now calls `assertFiscalPeriodOpen`. Fund-movement paths (`transferFunds`, `transferEquity`, `reconcileFund`) still do **not**; that is unchanged and still open.

## A.3 Rate limiting (R-1 … R-4)

- **New `lib/guarded-route.ts`** — one `guard(request, scope, ids)` call returning a response-or-null, so it cannot be swallowed by a handler's `catch`. Profiles `auth` / `public` / `expensive` / `export` / `recompute`, each spending an IP, user **and** tenant dimension, failing **closed** (503 if the counter store is unreachable) and returning 429 + `Retry-After`.
- **Applied to:** `analytics/stats`, `analytics/analysis`, `dividends/calculate` (expensive); `members/recalculate-financials`, `governance/performance/recalculate-all` (recompute — the 300 s jobs); `backup` GET, `reports/generate/[type]` (export); `auth/refresh` (auth, keyed on IP + the presented token's hash).
- **R-1 fixed** — `getAbuseClientIp` now trusts **only** `x-vercel-forwarded-for`. It previously read `x-real-ip` then `cf-connecting-ip` first, and Vercel sets neither, so one client-supplied header bought a fresh bucket per request (and a fresh `rate_limit_buckets` row each time). Its own docblock claimed "the spoofable header last"; the implementation had it first.
- **Pagination** — `page` clamped to ≤1000 in all 16 sites that parse it, bounding the OFFSET walk. `equityTransferSchema.transfers` gained `.max(500)`; `reports/export-generic` gained a 5000-row cap.

## A.4 Edge middleware (M-1, M-2, M-4)

- **M-2** — `/api/*` now verifies the JWT signature and expiry via the already-imported `verifyEdgeAccessToken`, instead of `cookies.has('accessToken')`. Handlers stay authoritative for blacklist/account-status/tenant state; the edge no longer forwards garbage tokens to them.
- **M-1** — already fixed in the tree on arrival (static-asset extension allowlist, cited as audit 07 L-7). Not re-applied.
- **M-4** — the `CRON_SECRET` liveness ping moved from `POST /api/backup` to `app/api/cron/backup/route.ts`, where the edge actually lets a bearer-authenticated scheduler through. It now uses the shared `authorizeCronRequest` instead of a second private constant-time comparison, and the old file carries a comment warning not to add `/api/backup` to `PUBLIC_PATHS`.

## A.5 Tests that pinned the vulnerabilities

Three tests failed *because the fixes worked*, and each asserted the insecure behaviour. Rewritten to assert the new contract:

- `lib/signup-hardening.test.ts` — "prefers the edge-stamped header over the spoofable first XFF entry" treated `x-real-ip` as edge-stamped, and a second test asserted raw `x-forwarded-for` was usable. Replaced with four cases: Vercel header wins; a spoofed `x-real-ip` is ignored; raw XFF is not trusted; absent headers → `unknown`.
- `__tests__/middleware.test.ts` — "APIs require the access cookie (**presence check**)" asserted `accessToken=fake` → 200. Renamed to "require a verifiable access token, not merely a cookie" and asserts 401 + `UNAUTHORIZED`.

## A.6 Deliberately not done

| Item | Why |
|---|---|
| Deleting the ~10 redundant endpoint twins | The guard divergence — the actual danger — is closed. The tree has ~50 `app/api/**` files open in a concurrent api-error codemod, and the UI is split ~60/40 across the two trees with different response envelopes, so each removal needs a paired client change. Staged as task #7. |
| `startDate`/`endDate` format validation in `/api/audit` | An unparseable value still yields a 500 rather than a 400. |
| Byte caps on `readJsonBody`/`readJsonUnknown` | Most mutating routes still rely on Vercel's ~4.5 MB platform ceiling rather than an explicit control. |
| `/api/audit` unindexed `details::text ILIKE` search | Needs an index or `to_tsvector`, i.e. a migration. |
| Single `requireAccess()` unifying the 4 auth stacks; one response envelope; the `route-manifest` build guard | Architecture-level, touches all 106 handlers — should land after the codemod settles. |
| `GET /api/backup` step-up re-auth (M-3), impersonation server-side stash (L-1), `isPlatformEdge` impersonation term (L-2), `diagnostics` verbosity (L-3), cross-tenant `/api/auth/users` for null-tenant callers (L-4) | Each is a product/policy decision rather than an unambiguous defect. |

**One item needs your deployment to confirm:** that Vercel really forwards a client-supplied `x-real-ip`. Run `curl -i -H "x-real-ip: 1.2.3.4" https://<preview>/api/auth/login` repeatedly before/after and check `rate_limit_buckets` — if a new row appears per header value, R-1 was live in production and the fix is load-bearing.
