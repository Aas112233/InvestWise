# InvestWise — Project Memory (curated)

## Environment

- **Local dev Postgres (active since 2026-10-04):** portable PostgreSQL 17.11
  at `C:\Users\mhass\pgsql\17`; start via `C:\Users\mhass\pgsql\pg-start.bat`
  (no service / no auto-start). `.env.local` DATABASE_URL points to
  `postgresql://postgres:postgres@localhost:5432/investwise` (Supabase URL
  kept as commented rollback in the same file). Schema+data restored from
  Supabase via session-pooler pg_dump (30 tables) PLUS demo tenant
  "green-valley" from `scripts/seed-demo-tenant.mjs` (120 members, 8
  projects, 24 months of transactions — deterministic, re-runnable,
  single-tx; refuses to run against Supabase). Dev logins:
  `admin@greenvalley.dev` / `pass-12345678` (Admin) and
  `superadmin@investwise.com` / `pass-12345678` (platform). pg_trgm
  extension installed locally + 4 trgm indexes recreated by hand. Re-sync =
  re-run pg_dump + pg_restore (extension ordering gotcha in daily log
  2026-10-04).
- **Database:** Supabase Postgres, transaction pooler (`:6543`), region
  `ap-northeast-1` (Tokyo). Dev machine is GMT+3 → ~200-300ms round-trip floor
  per query. **This is the #1 app-slowness factor.** Local Postgres now
  available for dev (see above); region move still the fix for prod.
- Two DB access layers coexist (migration in progress):
  - `db/index.ts` — used by `app/api/**` route handlers (`getDb()`).
  - `server/src/lib/db.ts` — used by `server/src/**` modules.
  Both use `postgres-js` with `prepare: false` (required for the pooler).

## Architecture conventions

- Next.js 15 App Router; all 21 `page.tsx` are currently `"use client"` and 18
  API routes are `force-dynamic` — i.e. effectively a SPA on Next.js. No SSR
  data. Server Components migration is the largest outstanding perf win.
- Auth: JWT access (15m) in HttpOnly cookie `accessToken`; `lib/middleware/auth.ts`
  (`getAuthContext`) has an in-process identity cache keyed by sha256(token),
  30s TTL. `server/src/lib/session.ts` has a separate 60s user cache.
- **Tenant isolation (§6) is enforced in: `listMembers`, `listFunds`,
  `app/api/deposits` GET, and ALL of `app/api/governance/*` incl. the NEW
  `governance/leaderboard` route (fixed 2026-09-27).** Earlier round also fixed
  transactions, audit, settings, meetings, goals, projects, auth/users.
  `requireTenant` fails closed (throws 403) rather than degrading to an
  unscoped query.

## Gotchas

- **Auth hydrate route is `/api/auth/me`** (fixed 2026-10-04): auth-context
  originally called `/api/auth/profile`, which never had a route (only
  `profile/password/` exists) → every hydrate 404 → user null → empty sidebar
  + TopNav fake fallbacks ("Dr. Garrison Spinka"/"MEMBER"/"Admin") rendering a
  dead session as logged-in. Fallbacks removed — an empty state must look
  empty. `/api/auth/me` returns top-level user JSON with normalized role +
  permissions map (client `AuthUser` shape). E2E probe technique: mint HS256
  JWT `{id, type:'access'}` with JWT_SECRET, curl with `Cookie: accessToken=`.
- **SuperAdmin (platform) gets 403 on ALL tenant endpoints by design**
  ("Platform operators must use /api/admin endpoints"). DB has only 2
  SuperAdmin users, 1 tenant ("Default Organization"), no tenant users →
  tenant dashboard shows honest zeros for them until a tenant account exists.

- **Live DB has hand-written check constraints NOT declared in the drizzle
  schema** (e.g. `funds_type_check`, `funds_status_check`) — `db:push` will
  neither create nor update them, and drizzle can't see them. On any `23514`
  error, inspect `pg_constraint` directly, don't trust the code schema.
  Fund-type vocabulary aligned 2026-10-02 across UI + server validation + DB
  check: `DEPOSIT, PRIMARY, PROJECT, RESERVE, EMERGENCY, OTHER` (signup subset:
  DEPOSIT/PRIMARY/OTHER, intentional). Migration script:
  `.workbuddy-ai/tmp/fix-funds-type-constraint.mjs` (idempotent). Live `funds`
  also has GLOBAL `UNIQUE(account_number)` (`funds_account_number_key`), not
  the per-tenant `uq_funds_tenant_account` the code declares.
- `getPaginationParams(query, { maxLimit })` — default ceiling is **100**. Any
  endpoint feeding a dropdown must pass `maxLimit` matching its Zod cap, or
  rows silently truncate.
- Zod `limit` caps and `maxLimit` must stay in sync (members: 500, funds: 200).
- `messages/ur.json` invalid-JSON issue (line 923) was fixed externally
  (verified 2026-09-27): all 4 locales parse and `tsc --noEmit` is fully clean.
- Tenant settings: always import from `lib/use-tenant-settings.ts`
  (single `["settings"]` query). Do NOT re-declare inline `/settings` fetchers.
- `logAudit` (lib/utils/audit.ts) accepts `tenantId?` since 2026-09-27 — most
  of its ~28 call sites still omit it → NULL-tenant audit rows (invisible in
  tenant-scoped audit table). Sweep pending. Backfill pending for NULL
  `tenant_id` rows in meetings/goals/member_penalties (+ audit_logs).
  Member routes (POST/PUT/DELETE /api/members*) now pass tenantId (2026-09-30).
- **tsconfig `include` whitelists specific `server/src` files only** — files
  NOT listed (e.g. legacy `modules/members/controller.ts|routes.ts|validation.ts`)
  are invisible to `tsc --noEmit`; broken imports there go undetected. The
  legacy Express members controller imports 7 functions that no longer exist
  in service.ts (dead code; would crash if the Express stack were started).
- Member edit forms MUST prefill from GET /api/members/[id] (full record),
  never from list rows — list rows omit PII fields by masking, and submitting
  them would null the columns. PII policy helper: `lib/member-privacy.ts`
  (shared by list service + detail endpoint; unit-tested in
  `lib/member-privacy.test.ts`).
- `members.phone` is NOT NULL — phone is required on create and edit (400 on
  empty). Member edit modal gates saving on the detail fetch completing.
- Member DELETE guards (400, not FK 500): any transactions (incl. soft-deleted),
  member_penalties, profit_allocations. Cascade-safe: member_arrears,
  meeting_attendees, project_members.
- Known deferred: `members.email`/`memberId` are globally unique across tenants
  (composite `(tenantId, email)` migration is the upgrade path); shares-lock
  race closed via `SELECT ... FOR UPDATE` transaction in PUT /api/members/[id].

## Performance round-trip fixes (2026-10-01)

- Latency re-measured: `SELECT 1` ≈ 240–260ms RT (1.7s cold TLS) on Tokyo pooler.
- N+1s batched: meetings create/complete/attendance (grouped MIN(date) +
  multi-row upsert on `uq_meeting_member`), arrears recalc (grouped
  `UPDATE…FROM (VALUES…)` + multi-row INSERT, now in a tx), dividend
  distribute (3 batched statements instead of 3×N; member equity update is
  DB-side numeric, tenant predicate kept in WHERE), share-consistency (GROUP BY).
- Sequential reads parallelized (Promise.all, error precedence preserved) in
  deposits ×4, dividends ×2, auth login/refresh/logout, members DELETE guards,
  expenses, settings (helper now returns fresh row). `/api/auth/me` keeps its
  fresh re-SELECT on purpose (profile freshness).
- Indexes live (both schema mirrors updated): `idx_trans_tenant_reference`
  (partial `WHERE is_deleted=false`), `idx_arrears_period`;
  `blacklisted_tokens.token` unique index already existed live (declaration
  synced as `uq_blacklisted_tokens_token`). Re-apply script:
  `.workbuddy-ai/tmp/add-indexes.mjs` (idempotent).
- Deferred: finance/service.ts per-item loops (bulkAddDeposits ~L1728,
  transferEquity ~L1513 — money-critical FOR UPDATE paths); auth cold-path
  reorder (security-sensitive); region move (user decision, biggest win).
- Validate edited server modules (outside tsconfig whitelist) with targeted
  strict tsc — command recorded in daily log 2026-10-01 (caught an implicit-any
  the project tsc missed).

## Tooling

- `DB_LOG_TIMING=1` → logs per-query wall-clock ms (`db/index.ts` `onquery`).
  Use this to measure round-trip latency before/after any region change.
- Tests: `npx vitest run` (189 passing as of 2026-10-02).
  Typecheck: `npx tsc --noEmit` (clean as of 2026-10-01).
- `npx next lint` is deprecated in Next 15 (migrate to ESLint CLI for Next 16).

## Module expectations (user-specified specs)

- User dictates module-by-module expectations; durable spec lives in
  `.workbuddy-ai/memory/module-expectations.md` — read it before touching any
  module listed there. Dashboard captured 2026-10-02 (4 definition questions
  still open with user; see that file). Append new modules; never rewrite old
  sections.
