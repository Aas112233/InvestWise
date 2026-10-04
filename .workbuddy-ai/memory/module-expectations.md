# InvestWise — Module Expectations (User-Specified Specs)

> Source of truth for how each module SHOULD work, as dictated by the user.
> Written verbatim-intent, checked against the current implementation.
> Status per item: ✅ matches today · ⚠️ partial · ❌ missing (with notes).
> Add a new section per module as the user dictates them. Do not rewrite
> earlier sections — append clarifications under the module they belong to.

---

## 1. Dashboard

**User expectation (2026-10-02):** "Dashboard displaying key financial and membership
metrics: total number of deposits, total shares distributed among members with a
breakdown of founding members versus normal members, the count of ongoing projects,
and the total number of investments. Include a chart showing the deposit submission
rate by month, a comparison of ongoing project income versus expenses, and a funds
health indicator summarizing overall financial status. Organize the metrics into
clear, at-a-glance sections with a clean, readable layout that stays up to date."

### Required metrics

| # | Metric | Status | Implementation notes |
|---|--------|--------|----------------------|
| 1 | Total number of deposits | ⚠️ | `/api/analytics/stats` returns `totalDeposits` as MONEY sum (`SUM(transactions.amount WHERE type='Deposit')`). Card exists. Count of deposits is NOT shown — clarify: money, count, or both. |
| 2 | Total shares distributed + founding vs normal breakdown | ❌ | Data exists: `members.shares` (int, NOT NULL) + `members.role` (`'Founding Member'` vs default `'Member'`). No dashboard metric today. Needs `SUM(shares) GROUP BY role` added to stats API + a card/donut. |
| 3 | Count of ongoing projects | ⚠️ | Exists only as helper text "Active Projects: N" under the Active Members card (`projects WHERE status='In Progress'`). Should be promoted to a proper metric. |
| 4 | Total number of investments | ❌ | No such metric. Candidates in schema: `projects.initialInvestment` (money), `projects.sharesInvested` (shares put into projects), or investment-type transactions. DEFINITION NEEDED FROM USER. |

### Required charts / indicators

| # | Element | Status | Implementation notes |
|---|---------|--------|----------------------|
| 5 | Deposit submission rate by month | ❌ | No time-series chart on dashboard. Data supports it: `transactions WHERE type='Deposit' GROUP BY month(date)` (`idx_trans_tenant_date` covers this). "Rate" definition needed: amount/month, count/month, or % of members hitting `monthlyDepositTarget` (members table has `monthlyDepositTarget`, `depositFrequency`, `lastDepositMonth`, `totalArrears`). |
| 6 | Ongoing project income vs expenses | ⚠️ | Current "Capital Flow Overview" bar chart compares lifetime deposits/expenses/dividends/reserves — NOT ongoing projects specifically. Projects track `totalExpenses`; project income = transactions with `projectId` set (income/earning types) — `projects.totalIncome` column does NOT exist. Needs a per-ongoing-project or aggregate income-vs-expense comparison. |
| 7 | Funds health indicator (overall financial status) | ⚠️ | Current "Portfolio Health" bar = project health counts (Stable/At Risk/Critical) — project management health, NOT financial status of funds. True fund health should derive from funds/reserves vs obligations. DEFINITION NEEDED (e.g. reserves vs expenses ratio, fund status pills, net position). |

### Layout & freshness

- ✅ Clean at-a-glance sections: KPI cards → charts grid → recent transactions + quick links.
- ✅ Freshness: `staleTime 60s` + refetch on focus via TanStack Query; skeleton loading states; honest zero states.
- Rule: keep real aggregates only — no fabricated demo numbers (AGENTS.md §0/§12).

### Backend work implied (when implementing)

- Extend `/api/analytics/stats` (tenant-scoped, parallel queries) with:
  shares total + by-role split, deposit count, monthly deposit series,
  ongoing-project income vs expenses, investment metric, funds-health input.
- All queries tenant-scoped (`requireTenant` fails closed) per AGENTS.md §6.

### Open questions (ask before building)

> IMPLEMENTED 2026-10-02 (user said proceed). Decisions taken, flagged to user:

1. "Total number of deposits" → BOTH: money (primary) + count (helper). ✅
2. "Total number of investments" → SUM(projects.initialInvestment) + project
   count. If user means something else (e.g. project_members.sharesInvested),
   swap the `investmentAgg` query only. ✅ (assumption flagged)
3. "Deposit submission rate" → % of ACTIVE members with ≥1 completed deposit
   per month (monthlyDepositTarget rejected as denominator — defaults to 0).
   ✅ (assumption flagged)
4. "Funds health" → runway-based: reserves ÷ avg monthly expenses (trailing
   3 calendar months ÷ 3); Good ≥12mo, Stable ≥6, At Risk ≥3, Critical <3 (or
   reserves ≤0 while burning). ✅ (assumption flagged)

### Implementation status (2026-10-02)

- API: `/api/analytics/stats` extended — all 7 spec items served from one
  tenant-scoped parallel batch. Types in `types/index.ts` (AnalyticsStats).
- UI: `components/dashboard/dashboard-view.tsx` rebuilt — KPI row 1 = user's
  4 metrics (shares card uses ERPMetricCard breakdowns for the founding/normal
  split); KPI row 2 = assets/dividends/members/expenses; charts = monthly
  deposit rate (ComposedChart bars+line), per-ongoing-project income vs
  expenses (grouped bars + surplus/deficit footer), funds-health panel;
  sector donut / recent transactions / quick links retained; old lifetime
  Capital Flow chart + project-health strip removed.
- i18n: 25 new `dashboard.*` keys in all 4 locales (130 total).
- Verified: tsc clean, vitest 124/124. Visual runtime check pending (needs
  dev server + login).

---

## 2. Transactions

**User expectation (2026-10-02):** "In this module the access user will see the
transactions of the tenants, user can search with any transaction id in the
search box, he can see the transaction, so we need proper db index."

### Requirements & status

| # | Requirement | Status | Implementation notes |
|---|-------------|--------|----------------------|
| 1 | Access user sees tenant's transactions | ✅ (pre-existing) | `GET /api/transactions` is §6 tenant-scoped (fail-closed), joined member/fund/project names tenant-checked. |
| 2 | Search box finds any transaction id | ✅ implemented 2026-10-02 | Full UUID → exact PK match. Otherwise contains-match over referenceNumber, description, `id::text`, and member name (all ILIKE, trgm-indexed). |
| 3 | "See the transaction" | ✅ (pre-existing) | Row → VoucherDrawer detail; soft-delete via modal. |
| 4 | Proper DB indexes for search | ✅ implemented 2026-10-02 | pg_trgm GIN: `idx_trans_ref_trgm`, `idx_trans_desc_trgm`, `idx_trans_id_text_trgm` (on `(id::text)`), `idx_members_name_trgm`. Applied live; EXPLAIN verified BitmapOr over trgm indexes (non-join plan). At ~500 rows planner still seq-scans the joined variant — correct cost choice, indexes kick in as data grows. |
| 5 | Search UX | ✅ | 300ms debounce added (was firing a ~250ms-RT query per keystroke). Placeholder updated in 4 locales to "Search by ID, reference, description, or member...". |

### Notes

- The old placeholder advertised member search but the API never matched
  member names — the member-name arm + `idx_members_name_trgm` makes that
  promise real (kept; not user-requested but honest-UI fix).
- Re-apply script if needed: `.workbuddy-ai/tmp/add-search-indexes.mjs`
  (idempotent, includes pg_trgm extension guard + EXPLAIN verification).
- Open question NOT asked (assumed): "transaction id" = UUID and/or
  referenceNumber — both covered. If user also wants member code search by
  `members.memberId` string (e.g. IW-M101), add an arm + trgm index on it.

---

## 3. Expenses

**User expectation (2026-10-02):** "This module is to submit non project related
expenses. Access user can add an expense by submitting all required fields like
expense name, reason, expense by-member, approved by, expense from fund, etc."

### Requirements & status

| # | Requirement | Status | Implementation notes |
|---|-------------|--------|----------------------|
| 1 | Non-project-related expenses | ✅ | Modal's project selector REMOVED (module purpose). API keeps optional `projectId` for legacy rows; project expenses belong to the Projects module. |
| 2 | Expense name (required) | ✅ implemented | NEW column `transactions.expense_name varchar(255)` (live via `.workbuddy-ai/tmp/add-expense-name-column.mjs`, both mirrors). Required server-side. |
| 3 | Reason | ✅ (pre-existing) | `description` (required). |
| 4 | Expense by member (required) | ✅ implemented | `memberId` now accepted + REQUIRED, tenant-validated; stored in `transactions.memberId`; shown via tenant-scoped members join. |
| 5 | Approved by | ✅ implemented | `approvedBy` (user id) accepted, tenant-user-validated → `authorizedBy`. Default when empty: submitter (also the old hardcoded behavior). UI dropdown from `/auth/users` (Admin/Manager only — graceful fallback hint if not listable). |
| 6 | Expense from fund | ✅ (pre-existing) | `fundId` required, active-fund + min-balance + atomic debit already enforced. |

### Notes

- Category dropdown kept (orthogonal label; user's "name" is the free-text field).
- GET /api/expenses now returns expenseName, memberName, approvedByName; list
  view has Expense Name / Expense By / Approved By columns.
- i18n: +8 `expenses.*` keys ×4 locales (script
  `.workbuddy-ai/tmp/add-expenses-i18n.py`).
- Decisions taken without asking: member required (user listed it under
  "required fields"); approver optional-with-fallback (blocks nothing if the
  caller can't read the user directory); project selector removed from UI only.

---

## 4. Funds

**User expectation (2026-10-02):** "Funds module is for keeping the funds like
deposits, expenses, emergency, project related funds. The funds module should
be bulletproof, because if a fund's data leaks with another one this will make
an issue with the other funds' transactions data. Transfers between funds must
have a proper trail — the transferred amount must be traceable."

### Requirements & status

| # | Requirement | Status | Implementation notes |
|---|-------------|--------|----------------------|
| 1 | Fund kinds: deposit / expense / emergency / project | ✅ | Types DEPOSIT/PRIMARY/RESERVE/PROJECT/OTHER existed; **EMERGENCY added** (modal, view filter, label key + i18n ×4). |
| 2 | Bulletproof isolation (no cross-fund/tenant leakage) | ✅ strengthened | All fund reads/writes §6 tenant-scoped. **Fixed lost-update races**: deposits POST, deposits approve, deposits revert, expenses POST previously read fund.balance unlocked and blind-wrote a computed value — a concurrent movement could silently vanish. Now every money tx locks the fund row `FOR UPDATE`, re-reads the balance inside the lock, re-validates sufficiency/reserve, and writes via atomic SQL arithmetic (`balance ± amount`); `balanceBefore/After` come from the locked read. Member `totalContributed` got the same treatment. Transfer + dividend paths already locked properly. |
| 3 | Transfer trail ("proper rail") | ✅ strengthened | Transfers already: single tx, sorted FOR UPDATE locks, cents math, paired `Transfer Out`/`Transfer In` legs w/ `-OUT`/`-IN` refs, balanceBefore/After, audit log w/ both tx ids. **NEW: `transactions.transfer_group_id`** (uuid, indexed partial) hard-links the two legs — queryable even if refs are user-supplied. Exposed in GET /api/transactions. |

### Notes

- Lock-order discipline is now global: funds sorted among themselves
  (transferFunds, dividends), funds-before-members (deposits/approve/revert)
  → no cross-path deadlock cycles.
- Deferred (pre-existing): `finance/service.ts` bulkAddDeposits per-item loop —
  same bulletproof pattern should be applied there eventually (flagged in
  perf notes since 2026-10-01).
- Migration scripts (idempotent): `.workbuddy-ai/tmp/add-transfer-group.mjs`.
- Fund DELETE guard: FK from transactions.fundId blocks deleting a fund with
  history (no code change needed).

## 5. Deposits & Members

Captured 2026-10-04.

### Requirements & status

| # | Requirement | Status | Implementation notes |
|---|-------------|--------|----------------------|
| 1 | Warning + Status columns visible ONLY to Admin and Manager roles | ✅ | **Corrected 2026-10-04 ~23:30: Manager, not Member** (first take said Member+Admin). `members-list-view.tsx`: Warnings (`warningCount`) + Status filtered out for Member/Auditor/SuperAdmin. `deposits-list-view.tsx`: Status filtered the same way (deposits table has no Warning column — confirmed with user, who chose "both tables"). Gate: `!!user && normalizeRole(user.role) ∈ {Admin, Manager}` — fail-closed until hydration (sidebar convention). Status filter dropdowns + receipt-sheet status intentionally untouched (spec was columns only). Side effect to watch: Member on the member-scoped Request Deposit screen no longer sees the Status column of their own requests. |
