# InvestWise — Enterprise Investment Management (Multi-Tenant SaaS)

> Migration target: Next.js 15 App Router. Current code (Vite SPA `client/` + Express API
> `server/src/`) is the behavioral reference — port behavior, don't redesign it mid-flight.

## Stack (target)

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript `strict: true`
- **Database:** Postgres/Supabase + Drizzle ORM — schema: `server/src/db/schema/*.ts`
  (`drizzle.config.ts`, `db:generate` / `db:migrate` / `db:push`)
- **Auth:** JWT access (15m) + refresh (7d, rotation) in HttpOnly cookies
  (`server/src/lib/jwt.ts`, `server/src/middleware/auth.ts`, `server/src/modules/auth/`)
- **Multi-tenancy:** shared DB + `tenantId` on every business table, `tenants` registry table,
  `requireTenant` + `requireSuperAdmin` guards. `system_settings` is one-row-per-tenant.
- **UI:** Tailwind CSS, shadcn/ui + Radix (`components/ui`), lucide-react icons, sonner toasts
- **Data:** TanStack Query 5 + TanStack Table 8, react-hook-form + Zod (`lib/schemas`)
- **i18n:** 4 mandatory locales in `client/i18n/translations.ts` (extend to `messages/` on Next.js)
- **Docs/PDF:** `jspdf` + `jspdf-autotable`, Excel via `exceljs` / `xlsx`
- **Tests:** Vitest; **Deploy:** Vercel (`vercel.json`, `/api/*` → server)

## Commands

```bash
npm run dev          # Vite dev (client) — after migration: next dev
npm run build        # vite build — after migration: next build
npm run lint         # eslint
npm run test         # vitest (client) / vitest run (server)
npm run typecheck    # tsc --noEmit (server)
npm run db:generate  # drizzle-kit generate (server)
npm run db:migrate   # drizzle-kit migrate (server)
npm run db:push      # drizzle-kit push (server, dev only)
```

---

## Core Architectural & Engineering Rules (MANDATORY FOR ALL AGENTS)

### 0. Production-Grade Integrity & Pushback Protocol (Anti-"Vibecode")

- **NEVER BE A YES-MAN:** If a proposal suggests float money math, client-only financial
  totals, missing FK relations, unscoped tenant queries, or weak auth, **PUSH BACK** and
  implement the industry standard instead.
- **NO SHALLOW ANSWERS:** Trace entity relations in `server/src/db/schema/`, verify FKs,
  check callers, run `typecheck`/`lint`/tests before declaring done.
- **Real-money standard:** This system moves real deposits, dividends, and equity. Zero
  tolerance for prototypes that break on edge cases (rounding, concurrency, partial failure).

### 1. No Emojis & Enterprise Aesthetic

- **STRICT:** No emojis in UI, toasts, commits, or logs. Use lucide-react SVG icons only.
- Enterprise ERP look: hairline borders, status pills, compact tables, muted uppercase labels.

### 2. Universal Data Tables & Pagination

- **Standard:** every list uses the shared `Table` (`client/components/ui/Table.tsx`) —
  after migration: `ERPDataTable` (`components/ui/erp-data-table`).
- Required: semantic sortable headers, hover states, `Skeleton` loading rows,
  empty state + action button, footer `startRow–endRow of totalCount` + page-size
  picker `[10, 20, 50, 100]` + prev/next.
- Client state tracks `page`/`pageSize`/`search`/`sortBy`/`sortOrder` and passes them into
  the query key AND the API params.

### 3. Button Hierarchy & Interactive States

- **Primary:** main actions (Add Deposit, Post Expense, Save). **Outline:** filters, exports,
  print. **Ghost:** row menus, drawer close, tab switchers. **Destructive:** delete/suspend.
- Prefix with Lucide icons (`size={13..16}`); during mutations disable + spinner
  (`Loader2 animate-spin`) + active label. Never a dead button with no feedback.

### 4. Universal Searchable Dropdowns

- **NO raw `<select>`** for dynamic data. Use the shared searchable dropdown
  (migrate to `AppDropdown` on Next.js) with portal rendering, loading + error states,
  debounce on endpoint-backed lists (members, funds, projects).

### 5. Cascading & Dependent Selectors (Parent → Child)

- Fund → Project (linkedFundId), Member → Deposit/Arrears, Project → Disbursement/Update,
  Meeting → Attendees → Penalties. Rules:
- Child filters by parent id; **disabled with placeholder** (`Select fund first…`) until
  parent chosen; **parent change resets child state immediately** to prevent cross-entity
  corruption. Never a standalone child pick where hierarchy exists.

### 6. Server-First Finance Logic & Tenant Isolation

- Deposit/expense/earning/dividend/equity-transfer/fund-transfer/reconcile math lives in
  server modules (`server/src/modules/finance/`, `funds/`, `governance/`) and is validated
  in route handlers with Zod. Client only orchestrates UI state — never trust client totals.
- **Every business-table query is tenant-scoped** (`where: eq(table.tenantId, tenantId)`).
  SuperAdmin (`role === 'SuperAdmin'`, see `lib/roles.ts` — numeric access levels
  were removed) bypasses tenant scope ONLY in
  `server/src/modules/admin/`. Cross-tenant ids are rejected at the API.

### 7. Data Fetching & Cache (TanStack Query v5)

- **Hierarchical keys, base noun first:** `["members", {...}]`, `["transactions", {...}]`,
  `["funds", ...]`, `["projects", ...]`, `["meetings", ...]`, `["goals", ...]`.
  **NO flat hyphenated roots** (`members-all`, `funds-dropdown`) — they break prefix invalidation.
- Mutations invalidate the base prefix: `onSuccess: () => qc.invalidateQueries({ queryKey: ["members"] })`.
- Reuse `deduplicatedGet` semantics (no duplicate in-flight GETs) and `useScreenDataRefresh`.

### 8. Date, Money & Fiscal Selectors

- Dates: tenant `dateFormat` (default `DD/MM/YYYY`) for display, ISO `yyyy-mm-dd` on the wire.
  Never raw `<input type="date">` or `toLocaleDateString()` in new code.
- Money: Postgres `decimal(15,2)` ↔ string boundary; **never float arithmetic** — integer
  cents or strict decimal helpers, 2dp rounding, `amount > 0` enforced server-side.
- Fiscal year / month pickers are dropdowns over dynamic fiscal arrays, not free text.

### 9. Zero Hardcoded Strings (4-Locale Rule)

- Every user-facing string lives in **all 4 locale entries** in
  `client/i18n/translations.ts` (migrate to `messages/{en,ur,hi,bn}.json`).
  `{variable}` placeholders must match across locales. No static text without `t()`.

### 10. Exported Documents (PDF & Excel)

- Reports, vouchers, ledgers, payslip-equivalents: localized headers, tenant currency,
  localized dates, UTF-8 safe (Bengali/Hindi/Urdu), RTL alignment for Urdu.

### 11. Universal API Error Formatting & Unmasked Toasts

- Field errors: `[Field '<field>', Code: <code>] <message>`. Client passes
  `toast.error(e?.message)` / `showNotification(...)` with the real server message —
  never a masked "Something went wrong".

### 12. Financial Invariants

- `decimal(15,2)` everywhere; no negative contra lines; `SUM(debits) === SUM(credits)`
  on journaled flows; overpayments route to advance/wallet, never silent extra receipts.
- **Share-value lock:** once transactions exist, `shareValueBdt` is immutable
  (`isShareValueLocked`, `LockedError`) — see `settings/service.ts`.
- **Soft delete:** transactions use `isDeleted` + `deletedBy`/`deletionReason`, never hard delete.
- **Idempotency:** bulk deposits, dividend runs, and transfers must be retry-safe
  (unique `referenceNumber` / request keys, 60s timeouts on long runs).

### 13. Ponytail Engineering Discipline

- YAGNI first; reuse helper/util/pattern already here; stdlib → native platform →
  installed dep → one line → only then new code. Fewest files, shortest working diff,
  boring over clever. See `.agents/rules/ponytail.md`.
- Mark deliberate ceilings with `ponytail:` comments + upgrade path.

### 14. Local-Only Execution & Git Protocol

- Modify the local workspace only. **Do NOT push to Vercel or deploy remotely** unless
  explicitly instructed. No commits/pushes unless explicitly requested.

### 15. Zero Unsolicited Pre-selections (Explicit User Choice)

- Forms, filters, and money desks MUST start empty (`""`/`null`) with placeholders
  (`Select member…`, `Select fund…`, `Select month…`). Never `items[0]`, `"CASH"`,
  or current-month defaults. Submit stays disabled/invalid until the user explicitly chooses.
  Selecting a member must NEVER auto-select fund/month/method.

---

## Design System Reference

| UI Element | Component | Path (current → Next.js target) |
|---|---|---|
| Data tables + pagination | `Table` → `ERPDataTable` | `client/components/ui/Table.tsx` → `components/ui/erp-data-table` |
| KPI cards | `StatCard`/`SummaryMetricCard` → `ERPMetricCard` | `client/components/StatCard.tsx` → `components/ui/erp-metric-card` |
| Skeletons | `Skeleton` family → `TableSkeleton` | `client/components/ui/Skeleton.tsx` |
| Forms | RHF+Zod inline → `TopSheet` + `ERPForm*` | → `components/ui/top-sheet`, `components/ui/erp-form-layout` |
| Dropdowns | inline selects → `AppDropdown` | → `components/ui/app-dropdown` |
| Status pills | inline classes → `StatusBadge` | → `components/ui/status-badge` |
| Guards | `ProtectedRoute`, `PermissionGuard` | → `middleware.ts` + server guards |

Full tokens + patterns: `.agents/rules/design-system.md`. Full behaviors: `APP_CONTEXT.md`.

## Skill Routing

| Task | Skill / Tool |
|---|---|
| Minimal, non-bloated implementation | `ponytail`, `ponytail-review` |
| Codebase navigation | CodeGraph (`codegraph explore / node`) |
| New page / route (target) | `nextjs-app-router-patterns` |
| Schema / migration / query | `drizzle-orm-expert`, `postgres-best-practices` |
| Forms / validation | `zod-validation-expert` |
| UI / styling | `shadcn`, `tailwind-patterns` |
| Multi-tenant isolation | `saas-multi-tenant` |
| Auth / sessions | `auth-implementation-patterns`, `backend-security-coder` |
| Money math / ledger | `ledger` invariants in this file (§12) |
| Failing tests / pre-flight | `test-fixing`, `verification-before-completion` |
| Pentest / vuln fix | `penetration-testing-with-strix`, `fix-security-vulnerabilities-with-strix` |

## Pre-Flight Verification

Before declaring any task done:

1. `npm run typecheck` (server) + `npx tsc --noEmit` (client / app) — zero errors.
2. `npm run lint` — zero new warnings.
3. `npm test` / `vitest run` — affected suites green.
4. Tenant check: cross-tenant read rejected; suspended tenant blocked; admin actions audit-logged.
5. i18n check: no new hardcoded user-facing strings; 4-locale keys in sync.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
