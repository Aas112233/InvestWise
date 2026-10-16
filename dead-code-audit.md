# InvestWise — Dead Code Audit

**Date:** 2026-10-16 · **Scope:** `app/`, `lib/`, `components/`, `hooks/`, `types/`, `server/src/`, `scripts/`, `db/`, root files (462 source files)

## Method (trust, but verify)

1. **Import-graph analysis** (custom static resolver handling `@/`, `@/server/*`, relative specs, barrel re-export chains with fixpoint propagation, dynamic `import()`) → orphan files & isolated clusters.
2. **Symbol-level analysis** of every `export` vs. every named/namespace import → unused exports, with an "used internally" distinction.
3. **`tsc --noEmit`** → 0 errors (note: only covers files in the tsconfig import graph; orphaned `server/src/db/*` scripts are **not** type-checked at all).
4. **`eslint .`** → 0 errors, 59 warnings (all pre-existing hooks patterns documented in `eslint.config.mjs`; **zero unused-vars findings** → no dead local variables anywhere).
5. **Manual verification** of every financial-sensitive candidate via targeted grep of all call sites. The analyzer was itself debug-verified against known-live symbols (`toCents`, `splitDividendByShares`, `apiClient`, `AppShell`) and confirmed deterministic across runs.

Result classes below are all **verified**, not guesses.

---

## Tier 1 — Verified dead, safe to remove (no financial logic)

### 1a. Orphan files (imported by nothing, not convention entries)

| File | Size | Notes |
|---|---|---|
| `hooks/use-unsaved-changes-guard.ts` | 95 lines | Hook never referenced anywhere |
| `lib/design-tokens.ts` | 12 lines | `designTokens` const, never imported |
| `components/dashboard/index.ts` | — | Barrel; pages import `./dashboard-view` directly |
| `components/layout/index.ts` | — | Barrel; pages import `./app-shell` directly |

### 1b. One-off / throwaway scripts (never referenced from `package.json` or code)

| File | Verdict |
|---|---|
| `tmp_analysis_i18n.mjs` (297 L), `tmp_bn_proper.mjs` (343 L), `tmp_check_bn.mjs` (19 L) | Self-declared "One-off i18n patch" files, applied 2026-10-11. Root-level scratch. **Delete.** |
| `scripts/_dbg.mjs` | Debug script. **Delete.** |
| `scripts/r2-backup-upload.js`, `scripts/r2-restore-download.js` | Standalone R2 tools **that cannot run**: `@aws-sdk/client-s3` is not in `package.json` nor `node_modules`. Either install the dep or delete. |
| `server/src/db/init-db.ts`, `inspect-db.ts`, `push-schema-direct.ts`, `seed-3year-history.ts`, `verify-complete-math.ts`, `recalc-runner.ts` | One-off DB scripts, imported by nothing (and excluded from type-checking). `recalc-runner.ts` is the root of a dead cluster — see Tier 2. |
| `scripts/harnesses/` | **Empty directory.** Delete. |

### 1c. Root-level data dumps & artifacts (no references from any script)

- `check.yaml`, `members.yaml` (20 KB), `projects.yaml` (15 KB), `txns.yaml` (20 KB) — data snapshots from a 2026-10-04 session; nothing reads them. **Delete or move to a fixtures dir if still useful.**
- `shot-dashboard.png`, `shot-meetings.png`, `shot-members.png`, `shot-projects.png`, `shot-transactions.png` — screenshots, unreferenced.
- `tsconfig.tsbuildinfo` — build artifact (should be in `.gitignore`).
- `install.ps1`, `setup.bat`, `start-dev.ps1`, `run-dev.bat` (18 KB!) — four overlapping dev-launcher scripts; `npm run dev` is the canonical path per AGENTS.md. Keep at most one.
- `brag-output/`, `tour-output/`, `.codeartsdoer/`, `shots/` — third-party tooling artifacts (already ESLint-ignored). Safe to delete.

### 1d. Legacy UI component

- **`components/ui/table.tsx`** (119 lines) — the old shadcn `Table/TableHeader/TableBody/...` family. Only reference is the barrel re-export in `components/ui/index.ts` (lines 40–49), and **no importer ever requests these names** from the barrel. Superseded by `ERPDataTable` (AGENTS.md §2/Design System table). Remove the file **and** the barrel block.
- `components/ui/skeleton.tsx → TableSkeleton` — superseded (file's own comment says the ERP twin "replaces TableSkeleton"). No importer. Remove the export + barrel line 12. (`CardGridSkeleton` is live — do not remove.)
- `components/ui/erp-form-layout.tsx → ERPFormActions` — never imported.

---

## Tier 2 — Dead clusters (remove together or not at all)

### 2a. Analytics recompute chain (entirely unreachable in production)

```
server/src/db/recalc-runner.ts            (orphan script)
  ├── server/src/config/database.ts       (139 L — legacy DB entry point)
  └── server/src/modules/analytics/service.ts (508 L — getStats, recalculateAllStats, queueStatsRecalculation)
        └── server/src/lib/cache.ts       (88 L — only imported by analytics service)
```

Verified: the live dashboard (`app/api/analytics/stats/route.ts`, `analysis/route.ts`) runs its own inline queries against `@/db/index` and imports **none** of this chain. **`server/src/config/database.ts` is used in production by nothing** — the live server tree uses `server/src/lib/db.ts` instead (finance/members/funds/projects services + `middleware/api.ts` + `session.ts`).

### 2b. Legacy reports service

- `server/src/modules/reports/service.ts` (730 lines) — imported **only** by `server/src/__tests__/features.test.ts`. The live reports routes (`app/api/reports/generate/[type]`, `app/api/reports/export-generic`) reimplement everything via `lib/reports/{catalog,data,excel,pdf,csv,format}.ts`. The test only covers `convertToCsv`, which the live route has duplicated as a local function.
- If removed, remove `features.test.ts` too (it tests only dead code).

### 2c. Misplaced projects handler

- `server/src/modules/members/handlers.ts → handleListProjects` (line 117) — never imported by any route (funds routes import only `handleListFunds/handleCreateFund/handleUpdateFund`, members route imports `handleListMembers`).
- Its star import `import * as projectsService from '../projects/service'` (line 15) is the **only** consumer of `server/src/modules/projects/service.ts` (47 lines) → whole file is dead. Live project routes query the DB directly.

### 2d. Duplicate token generation (server side)

- `server/src/lib/jwt.ts` — only `verifyToken` + `COOKIE_NAMES` are live (via `session.ts` → `middleware/api.ts`). **`generateAccessToken`, `generateRefreshToken`, `generateTokenPair`, `TokenPayload` are dead** — all live token issuance uses `lib/utils/jwt.ts` (login, refresh, impersonate, superadmin-service). This is a real security-relevant duplication: two token-issuance implementations that can drift.

### 2e. Duplicate error classes

- `server/src/shared/errors.ts → LockedError`, `ValidationError` — dead copies. The live classes are `lib/utils/errors.ts` (used by ~100 routes). AGENTS.md §12's "see LockedError" refers to the live one. Note `AppError` **is** live (imported by `app/api/funds/transfer`).

### 2f. Dead auth guards in the live auth module

- `lib/middleware/auth.ts` (621 lines, live — `getAuthContext` used by ~60 routes) exports 5 **never-used** guards: `requireAdmin`, `requireRole`, `requireAnyPermission`, `requireDepositWritePermission`, `requireSuperAdmin`. Routes use `getAuthContext` + `requirePermission` + `requireManagerOrAdmin` directly. Removing them shrinks the auth surface — low risk, but do it after the rest is settled.

---

## Tier 3 — Dead exports inside live files (financial-touching; remove one-by-one with tests)

| Location | Dead symbol(s) | Note |
|---|---|---|
| `lib/money.ts` | `formatCents` | Never called. Display formatting goes through `lib/formatters.ts`/`useFormatMoney`. |
| `lib/money.ts` | `monthKeyToUtcEnd` | Never called. **Also contains a latent bug**: it adds a flat 31 days to the month start, so for short months the "end" date overshoots into the next month. Harmless only because it's dead. |
| `lib/money.ts` | `monthKeyToUtcStart` | Used internally only — export is unnecessary (keep the function). |
| `lib/ledger-selectors.ts` | `settledDepositConditions`, `settledDepositSql` | Ledger SQL builders with zero callers. Live selectors in the same file are the `*SqlPredicate` functions. |
| `lib/governance/performance.ts` | `manuallyAdjustMemberScore` | Never called (359-line file otherwise live). |
| `lib/governance/status-rules.ts` | `resolveRequiredMonthlyCents` | Never called from outside (status-service keeps its own copy internally). |
| `lib/formatters.ts` | `toIsoDateString` | Never called. |
| `lib/reports/catalog.ts` | `ReportDownloadFormat` | Unused type. |
| `lib/subscription-guard.ts` | `SubscriptionStatus` | Unused type export. |
| `lib/admin/date-input.ts` | `toDateTimeLocal` | Unused (`parseDateTimeInput`, `daysUntil` are live). |
| `lib/admin/notice-schema.ts` / `lib/admin/user-schema.ts` | `NoticeSeverity`, `UserStatus` (+ all other exports are internal-only) | |
| `lib/utils/types.ts` | `optionalStringField` | |
| `lib/utils/validation.ts` | `registerSchema`, `updateUserSchema`, `changePasswordSchema`, `adminPasswordResetSchema` | Legacy Express-era auth schemas; live auth routes use `lib/utils/password.ts` + `lib/middleware/auth.ts` validation. |
| `lib/i18n.tsx` | `DEFAULT_LOCALE`, `interpolate` | Internal-only usage — exports can be dropped, functions kept. |
| `types/index.ts` | `AppScreen` (enum), `AccessLevel` (enum) | SPA leftovers. `AccessLevel` **contradicts AGENTS.md §6** ("numeric access levels were removed") and migration `0002_rbac_remove_access_level.sql`. Remove both. |
| `components/users/types.ts` | `TenantRole`, `PERMISSION_LEVELS` | |
| `server/src/middleware/api.ts` | `tenantScope` | Never imported (routes define their own local `tenantScope`). |
| `server/src/lib/db.ts` | `closeDb` | Never called — note `instrumentation.ts` does not use it. |
| `server/src/config/env.ts` | `isProduction`, `isDevelopment` | (File lives in the dead 2a cluster anyway.) |
| `server/src/modules/finance/validation.ts` | `DepositPayload`, `BulkDepositPayload`, `ExpensePayload`, `EarningPayload`, `TransferPayload`, `EquityTransferPayload` | Unused `z.infer` type exports (the schemas themselves are live). |
| `server/src/modules/finance/dividend-engine.ts` | `DividendMemberSeed`, `DividendPayout`, `DividendPlan`, `DividendRunContext` | Unused type exports (engine is live via `app/api/dividends/*`). |
| `db/index.ts` (root, live) | `checkDbHealth`, `setAppContext`, `resetAppContext`, `schema` re-export | The RLS-context helpers are never invoked; the diagnostics route inlines its own health probe. |

*(~40 further "internal-only" type exports in `lib/governance/*`, `lib/deposit-excel.ts`, `lib/reports/*`, `components/ui/*` are harmless extra exports — optional cleanup, zero risk.)*

---

## Tier 4 — DANGER FLAGS (financial invariants)

1. **`scripts/realign-member-shares.mjs` — delete immediately.** Its own header says: *"FATAL / DEPRECATED: Realigning member shares from money contributions violates core domain invariants."* An 18-line script that breaks the share-value lock / fixed-equity rule (AGENTS.md §12, `lib/shares.ts` doc) is a live foot-gun in a financial app. Nothing references it.
2. **Two parallel schema trees.** `db/schema/*.ts` (root) and `server/src/db/schema/*.ts` (server) are two independent copies of the same tables. Drizzle-kit migrations are generated **only** from the root tree (`drizzle.config.ts → ./db/schema/index.ts`), while the `server/src` module tree (finance service, dividend engine, session, middleware) queries through the server-side copy. They can silently drift. This is the single biggest maintainability risk found. Not "dead code", but flag for a consolidation project (make one canonical tree).
3. **`monthKeyToUtcEnd` latent bug** (Tier 3) — if anyone "starts using" this dead function, short months will compute wrong period ends.
4. **Duplicate 0008 migration numbers** in `db/migrations/`: `0008_tenant_payment_methods.sql` + `0008_transactions_status_pending_rejected.sql`. Ordering ambiguity for fresh installs.

---

## Stale configuration & doc drift

- **`tsconfig.json` `exclude` block is entirely stale**: `server/src/modules/finance/controller.ts`, `finance/routes.ts`, `finance/share-consistency.ts`, and `client/` **no longer exist** (Express-era leftovers from a deleted tree). The `include` list cherry-picks 6 server files, which means **orphaned server files (the six `server/src/db/*` scripts) are never type-checked**.
- **AGENTS.md drift**: states `server/src` module tree "is live code, not a reference" — mostly true, but `analytics/`, `reports/`, `projects/` services are dead (Tier 2). §12's `settings/service.ts` reference (`isShareValueLocked`, `LockedError`) — `LockedError` lives in `lib/utils/errors.ts`, and no `server/src/modules/settings/` exists. Docs should be updated to match.
- `package.json` is clean: **all 18 runtime dependencies are imported** (no unused deps). `jose` (edge) + `jsonwebtoken` (node) is an intentional split, not duplication.

## Verified LIVE (do not touch)

These were flagged by intermediate tool runs and **manually confirmed in use** — listed so a cleanup pass doesn't accidentally remove them:
`lib/money.ts` core (`toCents`, `fromCents`, `sumCents`, `parsePositiveAmount`, `splitDividendByShares`, `splitByPercent`, `parsePercentBp`), `lib/shares.ts` (all, incl. `@deprecated sharesFromCents` which is test-kept by design), `lib/transaction-reversal.ts`, `lib/fiscal-*.ts`, `lib/middleware/auth.ts` (60+ routes), `lib/utils/*` (errors/jwt/cookies/password/types/audit/validation), `lib/ledger-selectors.ts` predicates, `server/src/modules/finance/*` (all handlers via `app/api/finance/**`), `server/src/members|funds` handlers, `server/src/lib/{db,jwt(verify),session,cache? no}`, `server/src/middleware/api.ts` guards, `db/index.ts` + `db/schema` (entire tree), `types/index.ts` main interfaces, `components/ui/table.tsx`'s barrel siblings (ERP family), `__tests__/middleware.test.ts`.

## Recommended cleanup order

1. **Tier 4.1 first**: delete `scripts/realign-member-shares.mjs` (safety).
2. **Tier 1** (independent, no cross-refs): scratch files, dumps, artifacts, orphan hooks/tokens, `table.tsx` + barrel block, `TableSkeleton` export.
3. **Tier 2 clusters** in one PR each, running `npm run typecheck && npm run lint && npm test` after every step — removal of `config/database.ts` is only safe together with 2a; `projects/service.ts` only together with `handleListProjects`.
4. **Tier 3** symbol-by-symbol (each is a one-line deletion; `tsc` will immediately flag any missed call site).
5. **Config/doc drift**: clean `tsconfig` exclude, fix migration numbering, update AGENTS.md.
6. **Separate project** (not cleanup): consolidate the two schema trees.

After each removal batch, `tsc --noEmit` is the safety net: any reference the import-graph missed (string-based, dynamic, or Next convention) will surface as a type error before you commit.

---

# Execution Log — 2026-10-16

Cleanup executed in 4 stages with `tsc` + `eslint` gates after each stage. **All file deletions went to the Windows Recycle Bin** (nothing destroyed; git-tracked items are also recoverable from HEAD).

## Removed

**Stage A — scratch/artifacts (no code references):**
`tmp_analysis_i18n.mjs`, `tmp_bn_proper.mjs`, `tmp_check_bn.mjs`, `check.yaml`, `members.yaml`, `projects.yaml`, `txns.yaml`, 5× `shot-*.png`, `tsconfig.tsbuildinfo`, `scripts/_dbg.mjs`, `scripts/r2-backup-upload.js`, `scripts/r2-restore-download.js` (unrunnable: `@aws-sdk` not installed), **`scripts/realign-member-shares.mjs`** (FATAL/DEPRECATED invariant violation), `brag-output/`, `tour-output/`, `shots/`, `.codeartsdoer/`.
**Kept deliberately:** `scripts/harnesses/` (17 tracked e2e/QA integrity harnesses — manual tools, not dead code), the four dev-launcher scripts (`install.ps1`, `setup.bat`, `start-dev.ps1`, `run-dev.bat` — working convenience tools, not dead code; consider consolidating to one), `skills-lock.json`.

**Stage B — dead clusters & orphans:**
`server/src/modules/analytics/service.ts`, `server/src/config/database.ts`, `server/src/config/env.ts`, `server/src/lib/cache.ts` (2a cluster), `server/src/modules/reports/service.ts` (+ its `features.test.ts` CSV block; the two self-contained financial-math test blocks were kept), `handleListProjects` + `server/src/modules/projects/service.ts` (2c), `hooks/use-unsaved-changes-guard.ts`, `lib/design-tokens.ts`, `components/dashboard/index.ts`, `components/layout/index.ts`, `components/ui/table.tsx` + barrel block + `TableSkeleton` export + `ERPFormActions`.

**Stage C — dead exports in live files:**
`lib/money.ts` (`formatCents`, `monthKeyToUtcEnd` — incl. the latent 31-day bug), `lib/ledger-selectors.ts` (`settledDepositConditions`, `settledDepositSql`, and the now-orphaned `INTERNAL_TRANSFER_TYPES`), `lib/governance/performance.ts` (`manuallyAdjustMemberScore` + orphaned `logAudit` import), `lib/formatters.ts` (`toIsoDateString`), `lib/reports/catalog.ts` (`ReportDownloadFormat`), `lib/subscription-guard.ts` (`SubscriptionStatus`), `lib/admin/date-input.ts` (`toDateTimeLocal`), `lib/admin/notice-schema.ts` (`NoticeSeverity`), `lib/admin/user-schema.ts` (`UserStatus`), `lib/utils/types.ts` (`optionalStringField`), `lib/utils/validation.ts` (`registerSchema`, `updateUserSchema`, `changePasswordSchema`, `adminPasswordResetSchema`), `types/index.ts` (`AppScreen`, `AccessLevel`), `components/users/types.ts` (`TenantRole`, `PERMISSION_LEVELS`), `server/src/middleware/api.ts` (`tenantScope`), `server/src/lib/db.ts` (`closeDb`), `server/src/shared/errors.ts` (`LockedError`, `ValidationError`), `server/src/lib/jwt.ts` (3 token generators + expiry consts — live `verifyToken`/`COOKIE_NAMES` kept), `server/src/modules/finance/validation.ts` (6 payload types), `server/src/modules/finance/dividend-engine.ts` (4 types unexported), `lib/middleware/auth.ts` (5 dead guards + dead re-export line + orphaned imports).

**Consolidations (the "wire" items):**
- `resolveRequiredMonthlyCents` — verified both copies semantically identical; canonical implementation now lives in pure `status-rules.ts`; `status-service.ts` imports it and re-exports (public API for `performance.ts` unchanged). One rule, one home.
- `tenantScope` — the central version and the route-local version have **different signatures** (`SessionUser → string|null` vs `AuthenticatedUser → SQL fragment`), so no merge: the unused central one was deleted, the live route-local copy kept.

## Config & docs fixed
- `tsconfig.json`: removed stale excludes (`client`, `finance/controller.ts`, `finance/routes.ts`, `finance/share-consistency.ts` — all nonexistent) and the stale include of deleted `projects/service.ts`.
- `AGENTS.md`: server-tree live/dead status updated; `LockedError` pointer fixed to `lib/utils/errors.ts`.

## Verification results
- `tsc --noEmit`: **0 errors** (after every stage)
- `eslint .`: **0 errors**, 58 warnings (all pre-existing documented hooks patterns)
- `npm test`: **352/352 tests passed** (34 files — dividend engine, transaction reversal, bulk-deposit idempotency, multitenant, fiscal, reports, permissions, hardening)
- `npm audit`: 7 high findings, **all one root** (`braces` GHSA-vfj7-8cjw-p6xm) in **dev-only tooling chains** (tailwindcss→chokidar, eslint-config-next→fast-glob). No runtime dependency is flagged; production request path is not exposed. Only fix is a breaking `tailwindcss` v3→v4 upgrade — recommend as a separate planned task, not `--force`.

## Incident note — restored files
After Stage B, an external restore (IDE/Recycle-Bin) put the 12 `server/src/` dead files back on disk (11 byte-identical to HEAD). Confirmed with the user as **accidental** and re-deleted the same 12 files + 3 dirs to Recycle Bin. Final re-verification after re-deletion: tsc 0, eslint 0, **352/352 tests pass**, import graph shows **0 orphans, 0 dead islands, 0 test-only files**, and zero fully-unused exports remain (the 61 remaining flagged entries are all internal-use-only type/symbol surface, not dead code).

## Deferred / flagged (not acted on)
1. **`db/index.ts`** — `checkDbHealth` and `export { schema }` are unused, but the file was being edited live during cleanup (your RLS-context removal landed in it). Remove when you're done with it.
2. **Two schema trees** (`db/schema/` vs `server/src/db/schema/`) — consolidation project, not a cleanup.
3. **`0008` duplicate migration numbers** — left untouched on purpose: renaming already-applied migrations would desync `drizzle.__drizzle_migrations` on existing databases.
4. **Dev launchers** — four overlapping scripts; consider keeping one.
5. `roundToCents` (`lib/money.ts`) is used only by its test — kept (tested money utility).
