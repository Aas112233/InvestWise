# Analysis Module — Deep Bug Hunt & Design Audit

Scope: `/analysis` screen (`app/analysis/page.tsx`, `components/analysis/analysis-view.tsx`), its API
(`app/api/analytics/analysis/route.ts`, `app/api/analytics/stats/route.ts`), and the shared machinery they
depend on (`lib/fiscal-periods.ts`, `lib/fiscal-period-options.ts`, `lib/tenant-modules.ts`,
`lib/middleware/auth.ts`, `lib/ledger-selectors.ts`, `lib/permissions.ts`).

Method: traced the money from the write side (deposits / dividend / project routes) to the read side
(analytics aggregates), verified every predicate against the schema (`db/schema/*.ts`), and cross-checked
the Analysis screen against Dashboard, Deposits and Governance definitions.

Severity: **H** = wrong numbers or wrong authorization in normal operation · **M** = wrong under common
edge conditions · **L** = robustness / consistency / dead code.

---

## 1. Authorization & entitlement (system-design)

### H1 — The `analysis` module entitlement is never enforced (prefix mismatch)
`lib/tenant-modules.ts:79` maps the route prefix `'/api/analysis'` to the `analysis` module, but the real
routes live at **`/api/analytics/analysis`** and **`/api/analytics/stats`**. `moduleForApiPath()`
(`lib/tenant-modules.ts:95-100`) does exact-segment prefix matching, so it returns `null` for
`/api/analytics/*` and the module gate in `lib/middleware/auth.ts:468-487` never fires for analytics.

Consequences:
- `analysis` is `defaultEnabled: false` (`lib/tenant-modules.ts:58`) — a newly created tenant is **not
  licensed** for it, yet the API serves it to every authenticated tenant user.
- The sidebar (`components/layout/sidebar.tsx:44`) filters nav items with `canRead()` (screen permission
  only) and **never consults `tenants.moduleAccess`**; the Member role baseline already grants
  `ANALYSIS: READ` (`lib/roles.ts:50-58`), so the nav link is visible too.
- The admin feature-flag panel (`/api/admin/feature-flags`) can toggle `analysis: false` and the toggle has
  **zero observable effect**. The "licensed module" is a dead control for this module.

Fix: add `['/api/analytics/analysis', 'analysis']` (keep `/api/analytics/stats` ungated or map it to a
core/dashboard concept — it feeds the always-visible Dashboard), and decide whether the sidebar should also
hide module-unlicensed items (currently it doesn't, for *any* module).

### H2 — Analytics routes skip the screen-permission check every other read route performs
Both `app/api/analytics/analysis/route.ts:12-19` and `app/api/analytics/stats/route.ts:33-41` do
`getAuthContext` + `requireTenant` and stop. Compare: `deposits` (READ/WRITE), `expenses`,
`dividends/calculate`, `members`, `fiscal/periods`, `transactions` all call `hasScreenPermission`.

A tenant user with an explicit `ANALYSIS: NONE` override is blocked in the UI (sidebar + AppShell 403 gate)
but a direct `GET /api/analytics/analysis` returns the full financial picture: every member's contributed
capital, shares, equity %, and month-by-month payment behavior. `app-shell.tsx:53` states the app's own
contract — "every API route re-checks permissions server-side, so the gate is UX, not the security
boundary" — and analytics violates that contract.

Fix: `if (!hasScreenPermission(user, 'ANALYSIS', 'READ')) throw new ForbiddenError(...)` in the analysis
route; give `stats` a `DASHBOARD` READ check (or document why the dashboard feed is exempt).

---

## 2. Data correctness (money on screen)

### H3 — Monthly Cash Flow chart counts unsettled, rejected and reverted deposits as inflow
`app/api/analytics/analysis/route.ts:56-60` fetches `yearTransactions` with **no status filter**, and the
trend loop at `:175-179` adds *every* `Deposit`/`Earning` row to `inflow`:

```ts
if (tx.type === "Deposit" || tx.type === "Earning") trend.inflow += tx.amount;
```

The write side guarantees these rows exist in a fiscal window:
- deposit **requests**: `type='Deposit', status='PENDING', category='Deposit Request'`
- **rejected** requests: `status='REJECTED'` (`app/api/deposits/[id]/reject/route.ts:106-114`)
- **reverted** deposits: `status='PENDING'` kept in the ledger with a `— REVERTED:` description
  (`app/api/deposits/[id]/revert/route.ts:169-177`)

All three land in the chart as collected inflow, while the same screen's "Total Capital Invested" KPI
(`:126`) and the Payment Matrix (`:252`) use the settled definition
`status IN ('Completed','Success')` (`lib/ledger-selectors.ts:24`). The chart total will exceed the KPI and
contradict the matrix — precisely the "four screens, four answers" bug class this codebase has been
repeatedly fixing (report issues 27/34/47 in the `lib/ledger-selectors.ts` header).

Fix: in the trend loop, only count `Deposit` rows whose status is in `SETTLED_DEPOSIT_STATUSES` (or push
the settled predicate into the SQL for Deposit-typed rows, using the shared `inflowSqlPredicate()`).

### H4 — Per-member view mixes scopes: "Portfolio Net Return" and ROI are meaningless
When `memberId` is set, `allTimeTxAgg` (`route.ts:121-137`) is member-filtered, but the treasury is not:

```
totalInvested   = member's settled deposits   (per member)
totalDividends  = member's dividend receipts  (per member)
totalAssetValue = ALL active fund balances    (tenant-wide, route.ts:99-104, 336-347)
netProfit       = totalAssetValue + totalDividends - totalInvested
roi             = netProfit / totalInvested
```

Select a small shareholder: `netProfit ≈ whole-tenant treasury − their deposits`, and `roi` divides that
by *their* deposits → absurd percentages presented as "Portfolio Net Return". The Sector Allocation, Risk
Distribution and Leaderboard tabs are likewise tenant-wide in a member-filtered view, with no visual
indicator that the top KPI cards and the matrix/chart use different scopes.

Fix options: (a) drop/relabour the return KPI cards when `memberId !== 'all'` (show only the member's
deposit/dividend figures), or (b) compute a true per-member return (attribution of earnings is not modeled
today — so (a) is the honest one). Add a scope badge ("Tenant-wide" vs "Shareholder: X") to the tabs that
stay tenant-wide.

### M1 — SQL fetch window is keyed on posting date, bucketing on `deposit_month` (asymmetric #57 fix)
The year query filters `transactions.date BETWEEN periodStart AND periodEnd` (`route.ts:56-60`) — i.e. the
**collected/posting date** — while both consumers bucket by the **deposit month** the money is for
(`:157-166`, `:253-262`, the #57 fix). A deposit made *for* a month inside the target FY but collected
*after* `periodEnd` (legal while the FY is still open — `assertFiscalPeriodOpen` checks the collected date,
`lib/fiscal-guard.ts:15-75`) is never fetched, so:
- the monthly bar undercounts that month, and
- the Payment Matrix marks that member **MISSED** for a month that actually has a settled deposit.

The reverse direction (posted inside the FY, for another FY) is handled (`:171`, `:262` skip). Same defect
class in the stats route: `DEPOSITS_WINDOW` (`app/api/analytics/stats/route.ts:17`) is an 11-month window on
`transactions.date` while the series buckets by `COALESCE(depositMonth, date)` (`:151-157`) — an
early-posted deposit for a recent month can fall outside the window and silently zero its bucket (the
comment at `:11-16` only considered the window being too narrow for the *fiscal year*, not for the
deposit-month offset).

Fix: widen the window to `(date BETWEEN …) OR (type='Deposit' AND depositMonth BETWEEN firstSlot AND lastSlot)`.

### M2 — Payment Matrix ignores `joinDate` and `depositFrequency`
The matrix (`route.ts:273-312`) gives every non-deleted member 12 monthly obligations from the start of the
FY. Two member attributes make that wrong:
- **`depositFrequency`** — the Governance module explicitly handles non-monthly schedules
  (`lib/governance/status-service.ts:276-278, 405-407, 591` — non-monthly members are skipped/annotated).
  A quarterly member in Analysis shows 9 fake `MISSED` cells, `0%` punctuality, and drags
  `collectionEfficiency` down.
- **`joinDate`** — a member who joined mid-FY is `MISSED` for every month before joining; their
  `punctualityScore` is ~0–25% for the whole year.

Two screens in the same product reach opposite conclusions about the same member (Governance: "not
applicable", Analysis: "9 months in arrears"). Fix: clamp obligations to `joinDate` (or member-creation)
and either skip or re-expect non-monthly frequencies, mirroring `status-service`.

### M3 — Future fiscal years read 100% punctual / 100% collection efficiency; current month is MISSED from day 1
- For a year after the current FY, `isFiscalMonthEvaluated` is false for all 12 slots
  (`lib/fiscal-periods.ts:61-64`), so `evaluatedSlots === 0` and the code defaults
  `punctualityScore = 100` (`route.ts:302`) and `collectionEfficiency = 100` (`:314-316`). The whole matrix
  is grey "PENDING" yet every score column says 100%. A year opened early (open FY rows can be created ahead
  of time — `useFiscalPeriodYears` exposes exactly the OPEN years) shows perfect punctuality for a year that
  hasn't started. Should be `null`/"—" (the footer totals already render "—" for un-evaluated columns; the
  per-member column and the KPI card don't).
- For the *current* FY, the in-progress month is evaluated immediately (`:283`, "the current month is
  included as before"), so on day 1 of the month every non-paying member shows a red `MISSED` for the month
  still running. The tenant already configures `governance.depositDueDate` and `gracePeriodDays`
  (`lib/use-tenant-settings.ts:40-41`) — the matrix ignores both. Either respect due-date + grace, or at
  least render the current month as PENDING until the due date passes.

### M4 — A malformed fiscal calendar takes the whole screen down (server 500 + client render crash)
- `updateSettingsSchema` (`lib/utils/validation.ts:147-155`) rejects only `start === end`. `start="January"`,
  `end="March"` is accepted. Then `resolveFiscalBounds` gives a 3-month window but `fiscalMonthSequence`
  always emits 12 months (`lib/fiscal-periods.ts:36-39`) and `fiscalStartYearForDate` assumes a full 12-month
  FY (`:93-98`). Analysis fetches 3 months of data into 12 slots, and the matrix marks members **MISSED for
  9 months that are not part of the tenant's fiscal year at all**. The settings screen should validate that
  start→end is exactly 11 months.
- A *legacy* row with a malformed month name ("Jul", "") is known to exist — `lib/fiscal-period-options.ts:66-69`
  and `components/layout/top-nav.tsx:169-182` both wrap their uses of these helpers in try/catch and fall
  back. The analysis route (`route.ts:45-46`) and the view (`analysis-view.tsx:94-96`) do not: the API
  500s with "must be a full English month name" and the client throws during render (whole page → error
  boundary) instead of degrading.
- Structural: the analysis window is derived from `systemSettings` month names, while posting is gated by
  the `fiscal_periods` rows (`lib/fiscal-guard.ts:40-51`). If the two disagree (month setting changed after
  periods were created, or custom period bounds), Analysis and the posting boundary silently diverge.

### M5 — Closed fiscal years cannot be selected; the view comment claims the opposite
`analysis-view.tsx:100-103`:
> "Every created fiscal year, marked (Open)/(Closed) — reporting covers closed history, so this list is not
> narrowed to the postable one."

But the picker is built from `useFiscalPeriodOptions().yearOptionsIncluding` →
`selectFiscalYears` (`lib/fiscal-period-options.ts:88-98`), which **filters to `status === 'OPEN'`**, and
`withYearOption` only re-adds the *currently selected* year. Once a tenant closes the FY (the normal flow —
close, then open the next), its Analysis is unreachable from the UI: the picker shows only the open year.
Read screens need *all* created years (labelled Open/Closed); only the *posting* pickers (deposit forms,
bulk modals) need the OPEN-only rule. The Reports screen (`components/reports/reports-view.tsx:92-101`)
has the same gap — worth fixing once in `fiscal-period-options` (e.g. a `yearOptionsAll` variant) and
reusing.

### M6 — API failure renders as a false "no data" screen; deposits don't invalidate analytics cache
- `app/analysis/page.tsx:30-41`: `useQuery` has no error handling. On 4xx/5xx the view renders with
  `data = null` and `isLoading = false` → four KPI cards at **0.00**, "No transaction records registered
  for FY…", "No shareholder records found". A broken request is indistinguishable from an empty tenant —
  for a money screen, that's dangerous. The Dashboard handles the same situation with an explicit,
  documented fallback (`app/page.tsx:16-47`); Analysis has neither fallback nor error toast/retry.
  (`AppDropdown` already supports `error`/`onRetry` props — unused here.)
- `app/analysis/page.tsx:43-54`: the member filter's query swallows all errors into `[]`, so a failed
  `/members` fetch silently removes every option from the filter (and the page keeps working as if there
  were no shareholders).
- Staleness: every deposit write path invalidates `["deposits"]`, `["members"]`, `["funds"]`
  (`components/deposits/deposit-modal.tsx:263-265` etc.) but **none invalidates `["analytics", …]`**.
  Record a deposit, click Analysis within 60s (staleTime) → the chart and matrix show the pre-deposit
  world with no indicator. Given deposits are the module's main input, the write side should invalidate
  the `["analytics"]` prefix.

---

## 3. Consistency & definition drift (medium/low)

### L1 — `totalDividends` is status-unfiltered (both routes)
`route.ts:127` and `stats/route.ts:124-128` sum all `Dividend` rows regardless of status. Safe *today*
because `dividends/distribute` always writes `status: 'Completed'` — but the canonical outflow predicate
requires settled dividends (`lib/ledger-selectors.ts:44`). The moment a pending-dividend state exists,
Analysis and the flow KPIs drift again. Use `SETTLED_DEPOSIT_STATUSES`-style filtering for symmetry.

### L2 — Chart flow definition diverges from the canonical predicates
`inflowSqlPredicate()` includes a `type = 'Investment'` branch (`lib/ledger-selectors.ts:35`) — no write
path ever creates that type (project legs are `'Project Investment'`, `app/api/projects/route.ts:233`), so
the branch is dead; and `outflowSqlPredicate()` includes `'Disbursement'`, which only appears in legacy
data. The analysis chart itself correctly ignores `Project Investment`/`Transfer In|Out` (internal
movements) — but the three "definitions of money flow" in the codebase (chart loop, inflow/outflow
predicates, deposits settled set) don't cite each other. Consolidate into `lib/ledger-selectors.ts` so the
next type rename can't silently zero a bar.

### L3 — Sector allocation includes Cancelled/Completed projects
"Committed capital by sector" (`route.ts:201-210`) sums `budget` across **all** non-deleted projects,
including `Cancelled` (`lib/utils/validation.ts:12`) whose capital was never deployed (and, for deleted
projects, was refunded — `app/api/projects/[id]/route.ts:499-513`). The pie can show a large slice of money
the org will never spend. The Dashboard chart does the same (client-side, `dashboard-view.tsx:130-148`) —
so they agree with each other, but the label should say "all-time committed budget" or exclude
Cancelled. (Dashboard also groups top-6 + "Other" and hides zero-budget sectors; Analysis shows every
sector including zero-value ones and caps nothing — same metric, different presentation, no "Other".)

### L4 — Leaderboard silently truncated at 15; "Cumulative Capital" ≠ KPI "Total Capital Invested"
`route.ts:322` — `slice(0, 15)` with no "and N more" indicator. `totalContributed` is a maintained
aggregate that also moves on equity transfers and reverts, while the KPI sums the settled deposit ledger —
the two columns intentionally differ, but nothing on the screen says so; add a helper text like the other
cards have.

### L5 — `submissionRate` can exceed 100% (stats route)
Numerator = distinct members with a deposit in the slot (includes soft-deleted members' historical rows);
denominator = `activeMembers` (live, `status='active'` only) — `stats/route.ts:281`. Edge case, but clamp
or align the two predicates.

### L6 — Client fiscal labels vs server fiscal data (up to ~10 min drift)
The view derives the FY label and column headers from `useTenantSettings` (client staleTime 5 min over a
server-side 5-min cache, `lib/use-tenant-settings.ts:63`, `app/api/settings/route.ts:13`), while the API
reads `systemSettings` directly. Right after an admin changes the fiscal month, headers can describe a
different calendar than the data. Send the server's fiscal months in the response (the client already
receives `monthKey`s) instead of re-deriving locally.

### L7 — No `withDbRetry` on the analysis route
`stats/route.ts:87` wraps its batch in `withDbRetry` (the comment cites pooler transient failures);
`analysis/route.ts:68-138` does not. A transient blip 500s a whole screen.

---

## 4. Dead code / cleanup (low)

| Location | Issue |
|---|---|
| `app/api/analytics/analysis/route.ts:128` | `totalExpenses` aggregated in `allTimeTxAgg` but never used — a full-tenant SUM on every request for nothing. |
| `app/api/analytics/analysis/route.ts:83` | `status: members.status` fetched, never read. |
| `lib/ledger-selectors.ts:35` | `type = 'Investment'` branch matches no written type (real type: `'Project Investment'`). |
| `lib/middleware/auth.ts:164-167` | `ADMIN_PATHS` constant defined, never referenced anywhere. |
| `components/analysis/analysis-view.tsx:73` | `HEALTH_COLORS["Good"]` — `projects.health` is a 3-value enum (`validation.ts:13`), "Good" is unreachable. |
| `app/api/analytics/stats/route.ts:163-167` | Monthly series adds `eq(transactions.status, 'Completed')` on top of `depositCond`'s `inArray(['Completed','Success'])` — narrows the series vs the headline `totalDeposits`, which includes `Success`. If any legacy `Success` rows exist, chart < total. |
| `analysis-view.tsx:179` | Year dropdown `clearable` (default true): clearing silently resets to the current FY — either support a real "all-time" view or disable clear. |

---

## 5. What is implemented correctly (keep)

- **Tenant scoping is fail-closed** on every analytics query (`requireTenant` + unconditional tenant
  predicates); cross-tenant `memberId` params match nothing instead of leaking.
- **Soft-deleted members** are consistently excluded from the roster, matching Dashboard.
- **`deposit_month` bucketing with the UTC mid-month anchor** (`route.ts:161-164, 258-259`) is the right
  fix for timezone drift between posting date and "month the money is for" — only the fetch window (M1)
  wasn't updated to match it.
- **Settled-capital KPI** (`route.ts:126`) and the #13 double-count fix (treasury = fund balances only)
  are correct against the write side.
- **One-deposit-per-month occupancy** on the write side guarantees the matrix's PAID semantics (a member
  can have at most one settled deposit per slot).
- Fiscal month **keys/offsets are consistent** between server (`fiscalMonthOffsetForDate`) and client
  (`regularityColumns` year-rollover math matches `buildFiscalMonthOptions`).

## 6. Suggested fix order

1. H1 + H2 (authorization): two small, high-value server-side changes; test with an `ANALYSIS: NONE` user
   and a tenant with `moduleAccess.analysis = false`.
2. H3 (settled-only inflow): one predicate change + a regression test with PENDING/REJECTED/reverted rows.
3. H4 (scope mixing): define the per-member contract, then either drop or correctly scope the KPI cards.
4. M1 (fetch window vs deposit_month): single SQL change, test at both FY boundaries.
5. M5 (closed-year picker) + M4 (fiscal-calendar validation & fallbacks): read-screen year options variant
   in `lib/fiscal-period-options.ts`, 11-month-span validation in settings, try/catch fallbacks like
   top-nav already uses.
6. M2/M3 (obligation model): reuse governance's frequency handling; evaluate current month from due date;
   `null` instead of 100 for un-evaluated years.
7. M6 (error state + invalidation) and the L-tier cleanups.

---

## 7. Resolution (applied 2026-10-17)

All findings above were fixed in this pass. Map of finding → change:

| Finding | Fix |
|---|---|
| H1 | `lib/tenant-modules.ts` — route prefix corrected to `/api/analytics/analysis`; both auth stacks (Next `lib/middleware/auth.ts` and legacy kernel `server/src/middleware/api.ts`) share this table, so the entitlement now actually gates the API. |
| H2 | `app/api/analytics/analysis/route.ts` — `hasScreenPermission(user, "ANALYSIS", "READ")` → 403. `/api/analytics/stats` documented as intentionally ungated (core Dashboard feed; no DASHBOARD screen exists). |
| H3 | Analysis trend loop now counts only settled deposits / settled dividends, mirroring `lib/ledger-selectors` (via one `isSettled` helper). |
| H4 | Response carries `scope: { memberScoped, memberName }`; view renders a scope banner + "Tenant-wide" badges on the treasury/return KPIs, sector, health and leaderboard sections. |
| M1 | Analysis year-query and stats deposit-series both fetch `posting-date window OR deposit_month in FY slot range` (the bucketing key is now a fetch key too). |
| M2 | Matrix obligation model: non-monthly `depositFrequency` members are never MISSED (reuses governance's exported `isMonthlySchedule`); obligations start at the member's join month. |
| M3 | `punctualityScore` / `collectionEfficiency` are `null` (rendered "—") when nothing was due to be evaluated; the in-progress month of the current FY evaluates only after `depositDueDate + gracePeriodDays`. |
| M4 | `updateSettingsSchema` + settings PUT now require end = month before start (full 12-month span); analysis route/view/stats route degrade malformed legacy month names to defaults instead of 500/crash; end month is always derived from start so a short stored span cannot shrink the window. |
| M5 | `lib/fiscal-period-options.ts` — new `selectAllFiscalYears` + `yearOptionsAll`/`yearOptionsAllIncluding`; Analysis and Reports pickers now list every created year, labelled (Open)/(Closed). Regression test updated to encode the posting-only-vs-read-all split. |
| M6 | Analysis page surfaces API + member-list errors (error card with retry; dropdown error + retry) instead of a false empty screen; all six deposit write paths invalidate `["analytics"]`. |
| L1 | Dividend totals (analysis + stats) now require settled status. |
| L2 | Dead `'Investment'` branch documented in `lib/ledger-selectors.ts`. |
| L3 | Cancelled projects excluded from sector allocation and risk distribution (API + Dashboard chart). |
| L4 | Leaderboard "Showing top 15 of N" note (`metrics.totalShareholders`) + cumulative-capital helper text. |
| L5 | `submissionRate` clamped to 100%. |
| L6 | FY label + month slots now travel in the response (`fiscalYearLabel`, `monthSlot`, `calYear`); the view renders from the server's calendar, with the local computation only as a loading/legacy fallback (guarded). |
| L7 | Analysis route batch wrapped in `withDbRetry`. |
| Dead code | Removed: `totalExpenses` aggregate, `members.status` select, `HEALTH_COLORS["Good"]`, `ADMIN_PATHS`, stats' double `status='Completed'` filter, year-dropdown clearable. |

Verification: `tsc --noEmit` clean, `vitest run` 417/417 passing (incl. updated
`__tests__/fiscal-period-pickers.test.ts`), `i18n:validate` OK (2,745 keys × 4 locales), eslint 0 errors
on all changed files (5 pre-existing warnings in untouched code).

Remaining product-level note: the client never receives `moduleAccess`, so an unlicensed tenant still
sees the Analysis link in the sidebar and lands on the (now correct) 403 error card. Hiding
module-unlicensed nav items for every one of the 14 licensable modules is a cross-cutting change that was
out of scope for this audit; the data itself is no longer reachable without a license.
