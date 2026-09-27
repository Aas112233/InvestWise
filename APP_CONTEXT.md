# APP_CONTEXT.md — InvestWise Investment Management (Agent Guide)

> Current: Vite SPA (`client/`) + Express API (`server/src/`).
> Target: Next.js 15 App Router. Port behavior 1:1 — this file is the contract.
> Base URL (local): client `http://localhost:5173`, API `http://localhost:5000/api`.
> Auth: JWT access (15m) + refresh (7d, rotation) in HttpOnly cookies; `protect` +
> `admin` / `managerOrAdmin` / `requirePermission(screen, level)` guards.
> Tenancy: shared DB, `tenantId` on business tables, `tenants` registry;
> `system_settings` one-row-per-tenant. SuperAdmin (`SuperAdmin` role only, no
> numeric levels — see `lib/roles.ts`) only in `modules/admin/`.

## 1. OVERVIEW & MODULES

| Module | Current UI | API | Next.js target |
|---|---|---|---|
| Dashboard | `client/components/Dashboard.tsx` | `GET /api/analytics/*` | `/` |
| Members | `Members.tsx` | `/api/members` | `/members` |
| Deposits (incl. Request) | `Deposits.tsx`, `RequestDeposit.tsx` | `/api/finance/deposits*` | `/deposits`, `/deposits/request` |
| Transactions ledger | `Transactions.tsx`, `ProjectTransactionMaster.tsx` | `/api/finance/transactions*` | `/transactions` |
| Expenses / Earnings | `Expenses.tsx` | `/api/finance/expenses`, `/earnings` | `/expenses`, `/earnings` |
| Dividends | `DividendManagement.tsx` | `/api/finance/dividends` | `/dividends` |
| Funds + reconcile/transfer | `FundsManagement.tsx` | `/api/funds`, `/api/finance/transfer`, `/funds/:id/reconcile` | `/funds` |
| Projects + updates | `ProjectManagement.tsx` | `/api/projects`, `/:id/updates` | `/projects`, `/projects/[id]` |
| Meetings + attendance | `MeetingsManagement.tsx`, `MeetingPerformanceHub.tsx` | `/api/meetings`, `/api/governance/*` | `/meetings` |
| Governance + penalties | `GovernancePerformance.tsx` | `/api/governance/*`, `/api/arrears` | `/governance` |
| Goals | `Goals.tsx` | `/api/goals` | `/goals` |
| Analysis | `Analysis.tsx` | `/api/analytics/*` | `/analysis` |
| Reports + exports | `Reports.tsx`, `ExportMenu.tsx` | `/api/reports/*` | `/reports` |
| Settings (4 tabs) | `Settings.tsx` (CONFIGURATIONS/PROFILES/USERS/AUDIT_BACKUPS) | `/api/settings`, `/api/auth/users*`, `/api/audit`, `/api/backup/*` | `/settings` |
| AI advisor | `AIAdvisorSidebar.tsx` | `/api/ai/*` | drawer on all routes |
| System-admin (new) | — | `/api/admin/tenants*` | `/system-admin/*` (SuperAdmin only) |

Global shell: `Sidebar` → page → `Table` lists + inline drawers/modals + searchable
dropdowns + `Toast`/`showNotification` + `SessionTimeoutDialog`. No raw `<select>`.

## 2. WORKFLOW SEQUENCES

All mutations: fill → Save → toast → TanStack prefix invalidation → table refresh.
Cancel/X on dirty form confirms first.

**Deposit (`POST /api/finance/deposits`, bulk `/bulk`):**
1. Select Member* → Fund* → Month* → `amount > 0` → method → note → Submit.
2. Server validates member+fund in same tenant, writes transaction (status
   Completed/Pending), updates member `totalContributed`/shares + fund `balance`.
   Duplicate `referenceNumber` rejected (idempotency).

**Expense (`POST /api/finance/expenses`) / Earning (`/earnings`):**
1. Select Fund* (→ Project if linked) → amount → category/reason → Submit.
2. Server checks fund balance floor, writes transaction, updates
   `project.totalExpenses/totalEarnings` + `currentFundBalance`.

**Dividend run (`POST /api/finance/dividends`, 60s timeout):**
1. Pick scope (global/project) + total amount → preview shares-weighted split → Confirm.
2. Server distributes by `shares`, one receipt line per member, retry-safe (run key).

**Equity transfer (`POST /api/finance/equity/transfer`, 60s):**
1. From-member → rows (to-member, shares, amount) → reason → Submit.
2. Server moves shares + contributed balances atomically; both sides stay ≥ 0.

**Fund transfer (`POST /api/finance/transfer`) + reconcile (`/funds/:id/reconcile`):**
1. Source → target → amount → authorizedBy → Submit. Reconcile recomputes balance
   from ledger and stamps `lastReconciledAt` + `reconciliationStatus`.

**Project lifecycle (`/api/projects`):**
1. Create: title*, category*, Fund* (linkedFundId), budget, ROI, dates → Save.
2. Disburse/Update (`POST /:id/updates`): type Earning|Expense, amount, description;
   server updates `totalEarnings/totalExpenses` + `currentFundBalance` with
   before/after snapshots. Edit/delete update via `PUT/DELETE /:id/updates/:updateId`.

**Meetings → attendance → penalties (`/api/meetings`, `/api/governance/*`):**
1. Create meeting (title*, date*, type FOUNDING_MEMBER|SHAREHOLDER|INVESTOR|GENERAL).
2. Mark attendance (PRESENT/ABSENT/EXCUSED + deposit PAID_ON_TIME|PAID_LATE|PENDING).
3. Absent/late escalates penalty tiers 1–4 (VERBAL_WARNING → FUND_DEDUCTION →
   SUSPENSION) via `penalty-service`; waive/resolve with reason + audit.

**Goals (`/api/goals`):** title*, targetAmount, currentAmount (server-clamped ≤ target),
deadline, linkedProject?. Status In Progress → Achieved (auto when current ≥ target).

**Settings (4 tabs):** organization / financial (share lock!) / governance (meeting day,
due date, grace, types, penalty rules) / system (locale, theme, dateFormat,
maintenance). Users tab: per-screen READ/WRITE/NONE matrix + password reset.
Audit/Backup tab: audit list + JSON download + restore + cloud list.

**System-admin (SuperAdmin):** Tenants list → Create (slug*, name*) → Suspend/Resume
(blocks all tenant logins, 423) → Maintenance toggle → per-tenant stats
(users/members/txns). Every action `logAudit` + toast with server message.

## 3. RELATIONAL DEPENDENCIES (parent → child)

- `tenants` is root scope for EVERYTHING. Switching tenant resets member/fund/project
  selection. Suspended tenant blocks auth for its users; SuperAdmin unaffected.
- `Fund → Project`: project list filtered by `linkedFundId`; `Select fund first…`
  until chosen; fund change clears `projectId`.
- `Member → Deposit/Arrears/Penalty`: deposit desk filtered by member; member change
  clears month/fund/method (never auto-select).
- `Project → Update/Disbursement`: update needs valid project; amounts roll into
  project totals + fund balance; deleting a project cascades updates + members links.
- `Meeting → Attendees → Penalties`: attendance needs meeting; penalty needs
  attendee + tier; waived/resolved penalties keep history (no hard delete).
- `FiscalPeriod → Transactions`: closed periods reject writes (close-date guard).
- Tenant isolation: every handler resolves `tenantId` from session and scopes all
  reads/writes; cross-tenant FK ids rejected with 403/404, never coerced.

## 4. FORM CONSTRAINTS

`*` = required (Zod `min(1)`). Dates display per tenant format, wire ISO. Money =
number `> 0`, 2dp, `decimal(15,2)` strings at API boundary. Dropdowns = searchable,
portal-rendered, with loading/error states.

| Form | Required * | Auto-generated (do NOT type) |
|---|---|---|
| Member | name, email, phone, shares ≥ 1 | `memberId` (display id), joinDate |
| Deposit | memberId, fundId, month, amount > 0 | `referenceNumber`, balances |
| Expense/Earning | fundId, amount > 0, category/reason | transaction id, before/after |
| Dividend run | scope, totalAmount > 0 | per-member split lines, run key |
| Equity transfer | fromMember, ≥1 (toMember, shares) | ledger entries |
| Fund transfer | sourceFund, targetFund, amount > 0 | transfer id |
| Project | title, category, description, startDate | totals, fund balance |
| Project update | type, amount > 0, description | before/after |
| Meeting | title, meetingDate, meetingType | attendance rows |
| Goal | title, targetAmount > 0 | status transitions |
| Tenant (admin) | slug (lowercase, unique), name | id, default settings row |

Edits on locked rows (share-value locked, published/paid/closed) are rejected with an
explanatory message — use the correction/adjustment flow, never delete history.

## 5. SUCCESS / ERROR INDICATORS (automation asserts)

- **Success:** `showNotification(...)` / `toast.success(...)` with keywords
  (`saved`, `Added`, `completed`, `distributed`, `reconciled`, `suspended`); table
  refreshes via prefix invalidation without manual reload.
- **Error:** `toast.error(e?.message)` with raw server text
  (`[Field '<field>', Code: <code>] <message>`); submit blocked until valid.
- **Tables:** footer `startRow–endRow of totalCount`, `[10,20,50,100]` picker,
  prev/next; loading = `Skeleton` rows; empty = message + action button.
- **Guards:** no session → `/login` (target) / Login screen (current); no permission →
  `Forbidden` / `Access restricted`; suspended tenant → 423 + notice; SuperAdmin-only
  routes 403 for tenant admins.
- **Exports:** PDF/Excel download with 4-locale headers, tenant currency + dates.
