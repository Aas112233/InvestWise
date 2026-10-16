# InvestWise — Security Audit (Verification Pass)

**Date:** 2026-10-13 · **Scope:** full live codebase — Next.js 16.4.0 App Router (`investwise_web_app`), PostgreSQL 17, multi-tenant financial SaaS · **Mode:** read-only, no source modified · **Baseline:** `docs/audit/00-EXECUTIVE-SUMMARY.md` (2026-09-27, 204 findings)

---

## 1. Verdict

**No P0/P1 exploitable findings remain.** Every critical and high finding in the  
2026-09-27 baseline audit is verified **fixed** in the current tree (evidence in  
§4). The residual findings below are hardening and integrity items; none of them  
currently yields cross-tenant data exposure, authentication bypass, or money  
manipulation.

| Severity    | Count | IDs            |
| ----------- | ----- | -------------- |
| P2 (Medium) | 1     | F-1            |
| P3 (Low)    | 3     | F-2, F-3, F-4  |
| Low         | 3     | F-5, F-6, F-7  |
| Info        | 3     | F-8, F-9, F-10 |

The single most important structural fact of this audit: **`tenantId` is derived  
exclusively from the database user row** — never from a header, query parameter,  
or body field — and the previously exploitable `x-user-*` header-trust branch has  
been *deleted outright* rather than patched (`lib/middleware/auth.ts:587-591`),  
with the edge middleware stripping those headers as defense in depth  
(`middleware.ts:60-65`).

---

## 2. Scope and method

Read-only audit executed along four verification tracks, mirroring the baseline  
audit's criticals:

1. **TenantId provenance & auth core** — JWT verification, session/blacklist  
   joins, guard layers, identity caches.
2. **Route enumeration** — every file under `app/api/**/route.ts` (97 files)  
   accounted for against a guard layer.
3. **Data access** — every by-id query shape in money paths, FK ownership  
   validation on request-body references, raw SQL parameterization.
4. **General security** — secrets, headers, CSRF, session hygiene, supply chain  
   (`npm audit`), non-route surfaces (Express layer, scripts).

Cross-checks used: the project's green gate (tsc clean + 304/304 vitest, per  
project memory), `npm audit --json` re-run 2026-10-13, glob-vs-grep route diffs,  
and direct reads of every cited line.

---

## 3. Findings

### F-1 (P2) — Production CSP allows `'unsafe-inline'` in `script-src`

**Location:** `next.config.ts:15-17` (TODO at `:8-14`)

```ts
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";
```

**Why it matters:** an inline-script allowlist converts *any* HTML-injection  
sink anywhere in the app into script execution. I searched for such sinks and  
found none today: zero `dangerouslySetInnerHTML` with dynamic content, zero  
server actions, zero file-upload paths. So this finding is **chained-only** — it  
is a force multiplier waiting for a future injection bug, not an exploitable  
hole today. It is nonetheless the highest-impact residual item because the  
weakness ships to every page in production.

**Exploit sketch (requires a second bug):** inject an inline event handler via  
any future unsanitized render path → executes under `'unsafe-inline'` and can  
issue same-origin requests with the user's session (the cookies themselves are  
HttpOnly, so the attacker exfiltrates rendered data and performs actions as the  
user rather than stealing the token directly).

**Fix:** migrate to a per-request nonce (middleware generates it, forwards it on  
the request, Next stamps scripts, the response header echoes the policy). The  
TODO comment correctly warns this forces dynamic rendering and needs a full  
browser pass over all screens on a production build — budget a sprint, not a  
patch.

---

### F-2 (P3) — `PUT /api/funds/[id]` accepts `linkedProjectId` without tenant-ownership validation

**Call chain (live):**

- `app/api/funds/[id]/route.ts:6-9` — `PUT` delegates to `handleUpdateFund`
- `server/src/modules/members/handlers.ts:100-111` — guards are correct:  
  `assertUuid(id)` → `requirePermission('FUNDS_MANAGEMENT','WRITE')` →  
  `requireTenant(user)` → then passes the **raw body** through:  
  `fundsService.updateFund(id, body as never, tenantId)` (`:106`)
- `server/src/modules/funds/service.ts:221-233` — explicit field allowlist  
  (good: no balance/tenantId passthrough) but `:229` forwards `linkedProjectId`  
  with no ownership check:

```ts
if (data.linkedProjectId !== undefined) updateFields.linkedProjectId = data.linkedProjectId;
```

**Schema gap:** `db/schema/funds.ts:11` declares `linkedProjectId:
uuid('linked_project_id')` **without** `.references(() => projects.id)`, and no  
migration adds the FK — contrast `db/schema/goals.ts:23`, which does declare it.

**Impact:** an authenticated Manager/Admin with `FUNDS_MANAGEMENT:WRITE` can  
store *any* UUID — including another tenant's project id — on their own fund  
row. I traced every consumer of the field: the only reader  
(`server/src/modules/finance/service.ts:1966-1976`, fund reconciliation)  
resolves it **tenant-scoped** (`and(eq(projects.id, …), eq(projects.tenantId,
tenantId))`), so a cross-tenant value silently never renders. Result: a  
dangling-reference **integrity** bug, not a data leak. Severity is Low (P3)  
because it requires a privileged insider role and yields no exposure.

**Inconsistency worth noting:** the goals routes do this correctly —  
`app/api/goals/route.ts:96-101` and `app/api/goals/[id]/route.ts:113-121`  
validate `linkedProjectId` against `projects` with the tenant predicate before  
writing. Funds should mirror that pattern.

**Fix (small, two parts):**

1. In `handleUpdateFund`, replace `body as never` with  
   `updateFundSchema.parse(body)` — the schema already exists at  
   `server/src/modules/funds/validation.ts:29`.
2. Add ownership validation for `linkedProjectId` (handler check or schema  
   refine) copying `app/api/goals/route.ts:101`. Optionally add the FK  
   constraint in a follow-up migration.

---

### F-3 (P3) — Maintenance-mode gate fails open on database error

**Location:** `lib/middleware/auth.ts:202-205`

```ts
} catch {
  // If we can't check, allow through
  value = { tenantMaintenance: false, globalMaintenance: false, globalMessage: null };
}
```

The fail-open value is then cached for 30s (`:206`). Maintenance mode is the  
operator's emergency off-switch; during a database incident — precisely when an  
operator is most likely to flip it — the gate silently reverts to "allow  
everything." Availability/operations concern, not a breach: an attacker who can  
induce this condition has already achieved worse.

**Fix:** fail closed — treat a query error as maintenance-on (503). If the  
concern is locking everyone out during a transient blip, cache the *last known  
good* flags with a short TTL instead of a hardcoded "open."

---

### F-4 (P3) — Dead Express layer still contains unscoped services (latent)

**Location:** `server/src/app.ts`, `server/src/index.ts`,  
`server/src/controllers/**`, `server/src/modules/*/routes.ts`

The baseline audit's central architectural complaint (§2 of the baseline: "two  
parallel implementations … that do not agree") is now **resolved in practice**:  
no npm script starts the Express server, and nothing under `app/` or `lib/`  
imports its routers/controllers. What *is* live is the delegated-handler slice  
(`server/src/modules/*/handlers.ts`), which Next.js routes import directly and  
which is fully tenant-scoped (verified handler-by-handler in §5).

However, the corpse remains in the build tree, is typechecked, and contains  
genuinely unscoped services (e.g. `getProjectById`, legacy meetings/goals  
services). It is unreachable today — one careless import or port remap from  
resurrection.

**Fix:** delete `server/src/{app.ts,index.ts,controllers,modules/*/routes.ts}`  
and the Express-only middleware, or add an eslint boundary rule forbidding  
`app/**` from importing `server/src/**/routes|controllers|app.ts`. The  
`server/src/db/**` + `server/src/modules/**/{service,handlers,validation}.ts`  
slice must stay — it is the live delegated implementation.

---

### F-5 (Low) — 30-second identity cache widens revocation propagation

**Location:** `lib/middleware/auth.ts:24-26, 286-289, 469`

Mechanics, verified: token verification and the **blacklist check run  
per-request** (TOKEN_REVOKED at `:270-273`) — logout is immediate. But on a  
cache hit the function returns a cached `{user, tenant}` snapshot (`:287-289`),  
so **role changes, status changes (suspended/inactive), and tenant-status  
changes propagate within ≤30 seconds** for a user actively holding a session.  
A suspended user or demoted Admin keeps their old privileges for at most the  
cache TTL.

**Fix options:** invalidate the cache entry on the relevant write paths (the  
suspend/demote routes already exist — they can drop the entry), or shorten the  
TTL to 5–10s. Given the blast radius (30s), acceptable to carry with  
monitoring, but it should not grow.

---

### F-6 (Low) — Seat-cap check has a count-then-insert race

**Location:** `app/api/auth/register/route.ts` (seat-cap enforcement)

Two concurrent `POST /api/auth/register` calls can both pass the seat count and  
both insert, temporarily exceeding the plan's seat cap by one or two. Financial  
impact is nil; billing-fairness impact is a rounding error. Documented in-code.

**Fix:** enforce seats transactionally (advisory lock, or  
`SELECT … FOR UPDATE` on the tenant row) around count-then-insert, or accept and  
reconcile on the next billing sweep.

---

### F-7 (Low) — 17 npm-audit vulnerabilities (8 moderate / 9 high / 0 critical)

**Re-run 2026-10-13:** `npm audit --json` → total 17, moderate 8, high 9,  
critical 0.

Two clusters:

1. **Dev-tooling chains** — `@esbuild-kit/*` (via `drizzle-kit`), `fast-glob`  
   (via `eslint`), `braces` (via `chokidar` → `tailwindcss`). Build-time only;  
   exploitability in a deployed context is negligible.
2. **Runtime-adjacent:** `exceljs@4.4.0` → `uuid@8.3.2`  
   (GHSA-w5hq-g745-h8pq, insecure randomness in UUID generation). `exceljs` is  
   used for report exports and is on the `serverExternalPackages` list  
   (`next.config.ts:25`), and `uuid` is directly imported only by DB init/seed  
   scripts — no credential or token derives from it. Still the one item here  
   that ships in the runtime path.

**Fix:** `npm audit fix` for the dev chains; for exceljs, either upgrade  
`exceljs` (breaking API churn — schedule it) or pin a patched `uuid` via  
`overrides` and re-verify export output.


### F-9 (Info) — Refresh-secret derivation drift between the two JWT stacks

`lib/utils/jwt.ts` (live) derives the refresh secret as `JWT_REFRESH_SECRET`  
or an HMAC-SHA256 derivation; `server/src/lib/jwt.ts` (dead stack) derives it  
differently, so tokens minted by one stack would not verify in the other. Moot  
while the Express stack is dead (F-4); deleting that stack removes this.

---

### F-10 (Info) — Flat react-query settings key

`lib/use-tenant-settings.ts` queries under a single flat `["settings"]` key  
(not per-tenant). The residual leak surface is closed at logout —  
`lib/auth-context.tsx` calls `getQueryClient().clear()`. Cosmetic hardening:  
namespace the key by tenant id.

---

## 4. Baseline criticals — verification results

All nine baseline Critical/High findings verified **fixed** in the 2026-10-13  
tree. This is the heart of the verification pass.

| ID | Baseline finding (2026-09-27)                                                   | Status    | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -- | ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1 | Unauthenticated full takeover via client-supplied `x-user-*` headers            | **FIXED** | Branch deleted outright — `lib/middleware/auth.ts:587-591` ("ponytail: no trusted-upstream identity path … Deleted outright"); identity headers stripped at the edge as defense in depth (`middleware.ts:60-65`)                                                                                                                                                                                                                                                   |
| C2 | Downloadable backup endpoint returned every tenant's data incl. password hashes | **FIXED** | Live export is scoped: `app/api/backup/route.ts` `performBackup` runs `SELECT * FROM … WHERE tenant_id = ${tenantId}` on every table (`:21-28`), behind `getAuthContext` + Admin/SuperAdmin + `requireTenant` (platform operators excluded, `:80-96`), with an audit log of row counts (`:106-112`); credential tables excluded from the export set (`:10-19`); `/api/backup/list` and `/api/backup/restore` are honest `not_implemented` stubs behind role checks |
| C3 | Cross-tenant transaction access                                                 | **FIXED** | `app/api/transactions/[id]/route.ts` — fully tenant-scoped GET + soft-delete with role check and fiscal-period guard                                                                                                                                                                                                                                                                                                                                               |
| C4 | Stale react-query cache leaked data across sessions on shared machines          | **FIXED** | `lib/auth-context.tsx` calls `getQueryClient().clear()` on logout                                                                                                                                                                                                                                                                                                                                                                                                  |
| C5 | NULL-tenant users world-readable                                                | **FIXED** | `requireTenant` (`lib/tenant.ts`) fails closed for null tenant; SuperAdmin + null tenant gets 403 `PLATFORM_USE_ADMIN_API`                                                                                                                                                                                                                                                                                                                                         |
| H1 | Missing unique index → refresh-token replay                                     | **FIXED** | `db/schema/blacklisted_tokens.ts` has `uniqueIndex('uq_blacklisted_tokens_token')`, enabling the 23505 replay guard in `app/api/auth/refresh/route.ts`                                                                                                                                                                                                                                                                                                             |
| H3 | Raw JWTs stored at rest                                                         | **FIXED** | blacklist stores sha256 only; every writer/reader keys on the same hash (schema comment)                                                                                                                                                                                                                                                                                                                                                                           |
| H4 | Mass assignment on fund update                                                  | **FIXED** | `updateFund` uses an explicit field allowlist (`server/src/modules/funds/service.ts:221-233`) — no balance/tenantId passthrough. Residual: F-2                                                                                                                                                                                                                                                                                                                     |
| H5 | Cookie deletion path mismatch                                                   | **FIXED** | `clearAuthCookies` (`lib/utils/cookies.ts`) deletes on the exact set-paths (access `/`, refresh `/api/auth`)                                                                                                                                                                                                                                                                                                                                                       |

---

## 5. Verified-correct inventory

Defense layers proven correct by direct code reading, not inference:

### 5.1 Tenant isolation core

- **tenantId provenance:** derived only from the DB user row  
  (`lib/middleware/auth.ts:296` selects `users.tenantId`; `getAuthContext`  
  resolves `user?.tenantId || tenant?.id`, `:596`). A repo-wide grep for  
  `tenantId[:=]\s*(body|data|payload|json)[.)]?` returns **zero matches** — no  
  handler anywhere accepts a client-supplied tenant.
- **Fail-closed tenant gate:** `requireTenant` (`lib/tenant.ts`) — SuperAdmin/  
  platform-owner with null tenant → 403 `PLATFORM_USE_ADMIN_API`; any null  
  tenant → 403 `TENANT_REQUIRED`.
- **Money paths:** every function in `server/src/modules/finance/service.ts`  
  (2158 lines) calls `requireTenant(user)` first and fetches with  
  `and(eq(x.id, id), eq(x.tenantId, tenantId))`; the one raw-SQL surface  
  (`reconcileFund`) parameterizes `tenant_id = ${tenantId}`. Updates are  
  scoped-fetch-then-act-by-id in the same transaction.
- **Projects family:** `requireProjectContext` (`app/api/projects/_helpers.ts`)  
  composes `getAuthContext` + fail-closed tenant + write→Manager/Admin;  
  `assertFundInTenant`; shareholder equity writes keep `m.tenant_id =
  ${tenantId}` inside grouped `VALUES` SQL.
- **FK ownership on request-body references:** `app/api/governance/penalties/route.ts`  
  validates meetingId/fundId tenant-scoped before insert; goals routes validate  
  `linkedProjectId` (`app/api/goals/route.ts:96-101`). Only funds diverges (F-2).

### 5.2 Route coverage — 97/97 accounted

- 75 route files call a tenant-scoped guard directly (`getAuthContext`,  
  `requireSession`, `requirePermission`, `requireProjectContext`, or a  
  delegated `handle*`).
- 15 `app/api/admin/**` files use `requireSuperAdmin` / the platform edge fence  
  (`/admin` requires platform claims in `middleware.ts`).
- 4 intentional public auth endpoints (`/api/auth/login`, `/refresh`,  
  `/forgot-password`, `/signup` — signup gated by the  
  `allow_public_registration` platform setting).
- 2 cron routes (`/api/cron/governance-sweep`, `/api/cron/subscription-expiry`)  
  require the `CRON_SECRET` bearer and fail closed when unset.
- 1 health probe (deliberately session-free, `middleware.ts:51-54`).
- 97 = 75 + 15 + 4 + 2 + 1. No unguarded route, no re-export trap.

### 5.3 Authentication & session

- Session-bound JWTs: HS256 pinned (`lib/utils/jwt.ts`), 15m access / 7d  
  refresh, HttpOnly cookies; refresh rotation with replay detection  
  (`app/api/auth/refresh/route.ts`: 23505 → replay path; 23514 →  
  constraint-drift AppError; rotated `sessionId` via `crypto.randomUUID()`).
- Blacklist checked per-request (immediate revocation on logout); identity  
  snapshot cached 30s (F-5).
- Login/refresh throttling (per-IP + per-email + global buckets, fail-closed);  
  signup additionally has kill switch, maintenance gate, 8KB body cap, global  
  ceiling, and Turnstile fail-closed in production.
- Password reset uses generic responses (no account-existence oracle).

### 5.4 Authorization

- RBAC matrix (SuperAdmin/Admin/Manager/Auditor/Member) enforced per route via  
  `requirePermission` / `getAuthContext`; SuperAdmin creation blocked in  
  register; platform-owner email reserved.
- Impersonation (`app/api/admin/impersonate/route.ts` +  
  `lib/superadmin-service.ts`): SuperAdmin-only; refuses targets with SuperAdmin  
  role or allowlisted email ("Cannot impersonate a platform operator"); stash  
  cookie; session deactivated in DB before cookie restore; tokens blacklisted  
  (sha256); every action audited; support sessions 30-min valid.

### 5.5 Data exposure

- Per-tenant partial unique indexes on users email  
  (`uq_users_tenant_email` / `uq_users_platform_email`) — the baseline's global  
  email unique (a cross-tenant existence oracle) is gone.
- Soft-deleted members excluded from all reads.
- Backup export excludes credential/session tables (F-8 note).

### 5.6 Browser & headers

- Full header set on `/:path*` (`next.config.ts`): `nosniff`,  
  `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, HSTS, CSP.
- Edge CSRF fence: cross-site state-changing requests rejected server-side  
  (`middleware.ts:82-91`), not relying on SameSite alone.
- No XSS sinks: zero `dangerouslySetInnerHTML`, zero server actions, zero  
  upload endpoints.

---

## 6. Residual risk assessment

**What an attacker would need to hurt this app today:** a zero-day in  
Next.js/React itself, or social-engineered credentials for a Manager+ account.  
Every path from "authenticated tenant user" to another tenant's data was  
enumerated and found closed; every path from "unauthenticated internet" to any  
state-changing route is behind the edge fence, the session join, or an explicit  
public-endpoint allowlist with its own throttling.

**The three risks actually worth tracking:**

1. F-1 (CSP `unsafe-inline`) — the only finding that can turn a future UI bug  
   into a breach. Track it.
2. F-4 (dead Express layer) — a latent cross-tenant service set one import away  
   from production. Delete it.
3. F-7 (dependencies) — 0 criticals, but the exceljs/uuid chain ships at  
   runtime. Schedule the upgrade.

---

## 7. Remediation plan (dependency order)

1. **F-2 — tenant-check `linkedProjectId` in `handleUpdateFund`** (also kills the  
   `body as never` cast by parsing with the existing `updateFundSchema`).  
   *Independent, ~30 lines + a test.*
2. **F-3 — maintenance check fails closed** on DB error. *Independent, 3 lines
   - a test.*
3. **F-5 — shrink or invalidate the 30s identity cache** on suspend/demote  
   writes. *Depends on nothing; coordinate with 1–2 to batch a release.*
4. **F-4 — delete/firewall the Express layer.** *After 1–3 land* (they touch  
   `server/src/modules/**`, and you want the diff clean before mass deletion).
5. **F-7 — `npm audit fix` the dev chains; upgrade or override exceljs/uuid.**  
   *Independent; verify report exports after.*
6. **F-1 — CSP nonce migration.** *Last: highest effort, needs a full browser  
   pass on a production build; do it as its own project.*
7. **Backlog:** F-6 seat lock, F-8 tenant_id columns, F-9 (resolved by 4),  
   F-10 query-key namespacing.

---

## 8. Re-verification appendix

Commands to re-run this audit's checks:

```bash
# Route guard accounting (expect 97 files; diff the unguarded list against §5.2)
find app/api -name route.ts | wc -l
grep -rL "getAuthContext\|requireSession\|requirePermission\|requireProjectContext\|handle[A-Z]" app/api --include=route.ts

# No client-supplied tenantId anywhere
grep -rEn "tenantId[:=]\s*(body|data|payload|json)[.)]?" app server lib

# Identity headers must never be read as auth (only the stripping fence)
grep -rn "x-user-" lib middleware.ts

# Supply chain
npm audit --json
```

**Audit trail:** this pass examined `middleware.ts`, `lib/middleware/auth.ts`,  
`lib/tenant.ts`, `lib/utils/jwt.ts`, `lib/utils/cookies.ts`,  
`lib/auth-context.tsx`, `next.config.ts`, `server/src/middleware/api.ts`,  
`server/src/lib/jwt.ts`, `server/src/modules/{finance,funds,members,projects,goals}/*`,  
`app/api/**` (all 97 route files, stratified), `app/api/backup/**`,  
`db/schema/**`, and `npm audit`. Read-only; no source files were modified.

*Prepared 2026-10-13. For the baseline findings detail see `docs/audit/`.*
