# Audit 03 — Frontend / UI Correctness, React Bugs, i18n & a11y

**Scope (read-only):** `app/**/page.tsx`, `app/**/layout.tsx`, `app/globals.css`, `components/**` (72 files), `hooks/**`, `lib/{formatters,i18n,clsx,design-tokens,api-client,auth-context,use-permissions,use-tenant-settings,query-client,providers}`, `messages/**`, `tailwind.config.ts`.
**Excluded:** `app/api/**` (owned by another auditor — one targeted read-only grep was used to confirm UI-002-adjacent and member-lookup behaviour; noted inline), `server/src/`.
**Toolchain state (given):** `tsc --noEmit` clean, `next lint` zero warnings, vitest 69/69. No type/lint findings are reported — this audit is semantic only.
`npm run i18n:validate` was executed: **`i18n OK: 1379 keys identical across en, ur, hi, bn.`** (key parity is healthy; the i18n findings below are *usage* defects, not missing keys.)

## Summary

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 18 |
| Medium | 28 |
| Low | 9 |
| **Total** | **61** |

Top user-visible risks: (1) the React Query cache is never cleared at logout and no query key is tenant/user-scoped, so a second sign-in in the same tab renders the previous user's data; (2) the tenant switcher is cosmetic (localStorage only) while every request is tenant-resolved server-side; (3) two different `["members","dropdown"]` fetchers with incompatible response shapes share one cache key → white screen on Deposits after visiting Dividends; (4) the dashboard and admin overview fabricate/aggregate numbers when the API fails; (5) the meeting-attendance roster never loads saved attendance and reports the whole club as ABSENT.

## Screen inventory

| Route | Component | Data source | Loading / Error / Empty | Notes |
|---|---|---|---|---|
| `/` | `DashboardView` (`app/page.tsx`) | `GET /analytics/stats`, `/projects`, `/members`, `/finance/transactions?limit=5` | skeleton / **none (fabricated fallback)** / "no data" cards | Critical: hardcoded money + `Math.max(totalMembers, 502)` |
| `/members` | `MembersListView` | `GET /members` (+`/settings`) | skeleton / `isError`→empty msg / empty+action | debounced search ✔; detail sheet takes member code (route accepts it ✔) |
| `/members` (detail sheet) | `MemberDetailSheet` | `GET /members/{id}` | skeleton / **no error branch** / "—" | raw enum status in a fixed emerald badge |
| `/deposits` | `DepositsListView` | `GET /deposits` (+ monthly total) | skeleton / `isError`→empty msg / empty+action | debounced ✔; review/delete invalidate only `["deposits"]` |
| `/deposits/request`, `/request-deposit` | `DepositRequestView` | `GET /deposits?memberId=…` | skeleton / error text / empty | **no `enabled` guard**; duplicate route |
| `/transactions` | `TransactionsListView` | `GET /finance/transactions`, `/metrics` | skeleton / **error swallowed → empty** / empty | un-debounced search; `canManage={true}` hardcoded |
| `/expenses` | `ExpensesView` | `GET /finance/expenses` | skeleton / **error swallowed** / empty+action | KPI summed over current page |
| `/funds` | `FundsView` | `GET /funds?limit=100` | skeleton / toast / empty+action | KPI over filtered, ≤100 rows; no pagination footer |
| `/dividends` | `DividendsView` | `GET /dividends`, `/members?limit=200` | skeleton / **error swallowed** / empty+action | cache-shape collision; hardcoded `BDT` |
| `/governance` | `GovernanceView` | `GET /governance/penalties`, `/leaderboard`, `/members` | skeleton / **error → `[]` → "no records"** / empty | page not reset on filter change |
| `/meetings` | `MeetingsListView` | `GET /meetings`, `/members` | skeleton / **error → `[]`** / empty+action | native `confirm()`; duplicate row handler |
| `/meetings` (attendance) | `MeetingAttendanceModal` | parent props | n/a | attendance state seeded once → always ABSENT |
| `/goals` | `GoalsView` | `GET /goals`, `/projects` | skeleton / **error → `[]`** / empty+action | edit path writes stale values (Critical) |
| `/projects` | `ProjectListView` + detail view | `GET /projects`, `/projects/{id}` | skeleton / **error → `[]`** / empty+action | native `confirm()`; raw `type="date"` |
| `/analysis` | `AnalysisView` | `GET /analytics/*` | skeleton / **no error branch** / "no data" | fully hardcoded English screen |
| `/reports` | `ReportsView` | `GET /reports/{type}` (raw `fetch`) | spinner / toast / — | raw `fetch` bypasses `apiClient` |
| `/audit`, `/admin/audit-logs` | `AuditLogsView` | `GET /audit`, `/audit/metadata` | skeleton / 403 panel + toast / error-aware empty | **best-implemented screen** (debounce, page reset, rowKey) |
| `/settings` | `SettingsPage` | `GET/PUT /settings` | skeleton / error + retry / forbidden | `router.replace()` in render; silent `0` fallbacks |
| `/login`, `/register`, `/forgot-password` | auth pages | `POST /auth/*` | `isSubmitting` ✔ / inline error ✔ | `router.replace()` in render (register) |
| `/subscription/inactive` | — | static | — | clean |
| `/admin/*` | `AdminShell` + pages | `/admin/*` | metric cards / **no error branch** / — | fake "Platform Healthy" ping; no mobile layout |

## Findings

### [UI-001] React Query cache survives logout — next sign-in in the same tab sees the previous user's data — Severity: Critical
- **Location:** `components/layout/top-nav.tsx:101-112`, `components/admin/admin-shell.tsx:96-104`, `lib/auth-context.tsx:100-112`, `lib/query-client.ts:15-20`
- **Evidence:**
```tsx
// top-nav.tsx:101
const handleLogout = async () => {
  setIsLoggingOut(true);
  try { await logout(); } finally { setIsLoggingOut(false); setProfileOpen(false); }
  // The shell paints regardless of auth state, so without navigation the
  // user sits on a dead session looking "not signed out".
  router.push("/login");            // ← client-side nav; no queryClient.clear()
};
```
```ts
// lib/query-client.ts:15 — one module-level client per browser tab
browserClient ??= new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });
```
- **Impact:** Every query key in the app (`["members", …]`, `["deposits", …]`, `["dividends", …]`, `["audit", …]`, `["settings"]`) is scoped by neither user nor tenant. `logout()` clears the profile but the cache survives, and the next login in the same tab renders the **previous user's members, deposits, dividends and audit rows** from cache (up to 5 min for `["settings"]`, see UI-006) before/without refetching — `refetchOnWindowFocus: false` means tab-switching back does not correct it.
- **Fix:** In `AuthProvider.logout()` inject the query client and call `queryClient.clear()` (or hard-navigate with `window.location.assign("/login")`); additionally scope keys: `["members", userId, tenantId, params]`. A `QueryClient` reset in `useEffect([user?.id])` is the belt-and-braces variant.
- **Needs verification:** confirm a second login in the same tab after logout. Steps: sign in as A, visit `/members` and `/dividends`, sign out, sign in as B (different tenant), navigate to `/members` — cached A-rows render before the refetch settles.

### [UI-002] Tenant switcher changes only localStorage — org label changes, data does not — Severity: Critical
- **Location:** `components/layout/top-nav.tsx:117-120, 168-186`; `lib/auth-context.tsx:60-68`; `lib/api-client.ts:50-57`
- **Evidence:**
```tsx
// top-nav.tsx:172 — selecting a tenant
onClick={() => { setTenantId(tn.id); setTenantMenuOpen(false); }}
```
```ts
// lib/auth-context.tsx:60 — "switching" a tenant is a localStorage write
const setTenantId = useCallback((id: string | null) => { setTenantIdState(id); localStorage.setItem(TENANT_KEY, id); }, []);
// lib/api-client.ts:50 — requests carry NO tenant header; the server resolves tenant from the JWT cookie
const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" } });
```
- **Impact:** A superadmin picks "Club B" in the header; the pill now says Club B while every table, KPI and money figure on screen still belongs to Club A. No refetch, no `router.refresh()`, no cache clear. It is the most dangerous class of bug here: a plausible-looking wrong-tenant ledger.
- **Fix:** Make tenant switching a real server operation — `POST /admin/switch-tenant` (or re-issue the session) — then `queryClient.clear()` + `router.refresh()`. If the switcher is intentionally cosmetic, remove the control rather than lying about the active tenant.
- **Needs verification:** whether some `middleware.ts`/server path reads `investwise:tenantId` and honours it (no such read exists in `lib/`). Confirm by switching tenants and checking the `Cookie`/response of the next `/api/*` call.

### [UI-003] Two `["members","dropdown"]` fetchers with different response shapes → white screen — Severity: Critical
- **Location:** `components/deposits/shared.ts:118-126` vs `components/dividends/dividends-view.tsx:80-88`; consumers `components/deposits/deposit-modal.tsx:86`, `bulk-deposit-modal.tsx:62`, `deposit-request-view.tsx:129`
- **Evidence:**
```ts
// components/deposits/shared.ts:118
export function useMemberOptions() {
  return useQuery({
    queryKey: ["members", "dropdown"],
    queryFn: async (): Promise<MemberOption[]> => {
      const res = await apiClient<PaginatedResponse<MemberOption>>("/members", { params: { page: 1, limit: 500 } });
      return res.data ?? [];                 // ← caches an ARRAY
    },
```
```tsx
// components/dividends/dividends-view.tsx:80
const { data: membersData } = useQuery<{ data: Array<{id:string;name:string;memberId:string}> }>({
  queryKey: ["members", "dropdown"],
  queryFn: async () => { try { return await apiClient("/members?limit=200"); } catch { return { data: [] }; } },
                                                     // ← caches an OBJECT {data:[…]}
});
```
```tsx
// components/deposits/deposit-modal.tsx:86 — assumes an array
const memberOptions = (membersQuery.data ?? []).filter((m) => m.status === "active").map(...)
```
- **Impact:** Same key, two shapes, one cache. Visit `/dividends` then `/deposits` in the same tab: `useMemberOptions` reads the object `{data:[…]}` and calls `.filter` on it → `TypeError` during render. `app/` contains **no `error.tsx`/`global-error.tsx`** (verified: `app/**/{error,loading,not-found,global-error}.tsx` → no matches), so the route throws to a blank page. The reverse order silently empties the Dividends member filter (`membersData?.data` → `undefined`).
- **Fix:** Make both fetchers return the same normalized shape (or use distinct keys, e.g. `["members","dropdown",{limit:500}]` vs `["members","options"]`). Add `app/error.tsx` + `app/global-error.tsx` regardless — see UI-049.
- **Needs verification:** reproduce in-browser (Dividends → Deposits, soft nav) and confirm the blank page.

### [UI-004] Dashboard fabricates money, member counts and "today" when the API fails — Severity: Critical
- **Location:** `app/page.tsx:14-34`; `components/dashboard/dashboard-view.tsx:41-47, 344, 366-376, 413-415`
- **Evidence:**
```tsx
// app/page.tsx:14 — error is converted into a plausible-looking snapshot
} catch {
  return { stats: { totalMembers: 24, totalAssets: 4850000, totalLiabilities: 1250000, monthlyCollection: 320000, activeFunds: 3 },
           members: [], projects: [], transactions: [] };
}
```
```tsx
// components/dashboard/dashboard-view.tsx:41
const totalStudents = stats?.totalMembers ? Math.max(stats.totalMembers, 502) : 502;   // never below 502
const staffMembers = 102;                                                             // hardcoded
const totalCollectedDisplay = `${"৳ "}${(stats?.monthlyCollection ?? 0).toLocaleString()}`;
const todayDateString = "27/09/2026";                                                 // hardcoded date
```
- **Impact:** On any 5xx/network failure the home screen shows invented figures — a tenant with 12 members is told it has 502, "Total Assets ৳4,850,000" is displayed as if real, and the date shown is a constant. The three list queries return `[]` on failure, so the widgets render their "no data" states with no error indication anywhere. This is the single most damaging UI defect for a financial product: wrong numbers presented with total confidence.
- **Fix:** Delete the fallback snapshot; surface `isError` with a retry, and render `—` for every metric when `stats` is undefined. Remove `Math.max(..., 502)`/`102`/`"27/09/2026"` and derive the date from `new Date()`. Labels must come from the domain ("Total Members", "Collected This Month"), not the school-ERP leftovers currently shown.
- **Needs verification:** none — code-path is unambiguous.

### [UI-005] `GoalFormModal` prop→state desync: editing goal A then goal B writes A's amounts onto B — Severity: Critical
- **Location:** `components/goals/goal-form-modal.tsx:25-37`; `app/goals/page.tsx:113-116, 126-137`
- **Evidence:**
```tsx
// goal-form-modal.tsx:25 — state seeded from props ONCE, never re-synced
const [title, setTitle] = useState(initialData?.title || "");
const [targetAmount, setTargetAmount] = useState(initialData?.targetAmount ? String(initialData.targetAmount) : "");
const [currentAmount, setCurrentAmount] = useState(initialData?.currentAmount ? String(initialData.currentAmount) : "0");
```
```tsx
// app/goals/page.tsx:113 — the edit path is live; initialData changes per goal
onOpenEdit={(goal) => { setEditingGoal(goal); setIsFormOpen(true); }}
…
<GoalFormModal initialData={editingGoal} onSubmit={async (data) => { await saveGoalMutation.mutateAsync(data); }} … />
```
- **Impact:** The modal component stays mounted, so its `useState` initializers run only on first mount (the create case, all empty). Open **Edit → Goal A**: the title says "Edit Goal" but the fields are empty/stale, and `saveGoalMutation` PUTs to `/goals/{A.id}`. Type values, close, open **Edit → Goal B**: the form still shows what you typed for A, the header says "Edit Goal" (B), and saving PUTs A's `targetAmount`/`currentAmount`/`currentAmount`-driven `status` onto **B**. Money and milestone status are silently written to the wrong goal; the same class of bug affects `ProjectFormModal` (`project-form-modal.tsx:25-40`, `initialData` currently unwired = latent) and `ProjectUpdateModal` (`project-update-modal.tsx:24-26`, stale text/amount between opens).
- **Fix:** `useEffect(() => { reset(seedFrom(initialData)); }, [initialData])` on every open (`reset`, not `defaultValues`), or key the modal: `<GoalFormModal key={editingGoal?.id ?? "new"} …>`.
- **Needs verification:** end-to-end: create a goal, edit it, close, edit a different goal and save — observe the other goal's amounts.

### [UI-006] `["settings"]` unscoped + `refetchOnMount:false` + 5-min staleTime → previous tenant's currency/date/org name — Severity: Critical
- **Location:** `lib/use-tenant-settings.ts:31-48`; `lib/auth-context.tsx:100-112`; `components/layout/top-nav.tsx:118-120`
- **Evidence:**
```ts
// lib/use-tenant-settings.ts:34
return useQuery({
  queryKey: ["settings"],                       // no user/tenant scope
  queryFn: () => apiClient<TenantSettings>("/settings"),
  staleTime: SETTINGS_STALE_MS,                  // 5 * 60_000
  refetchOnMount: false,                         // never re-reads on a new session
});
```
```ts
// lib/auth-context.tsx:100 — logout does not remove the tenant key
const logout = useCallback(async () => { await fetch("/api/auth/logout", …); localStorage.removeItem(PROFILE_KEY); setUser(null); }, []);
```
- **Impact:** `useTenantCurrency()`/`useTenantDateFormat()` feed **every money cell and date cell in the product**. After UI-001's sign-out/sign-in cycle, a user whose tenant is USD sees the previous tenant's BDT/USD code, date pattern and organisation name for up to 5 minutes, and the header falls back to `Tenant ${user.tenantId.slice(0,8)}` using the stale `investwise:tenantId` left in localStorage. This is a cross-tenant display leak on the highest-traffic surface.
- **Fix:** `queryKey: ["settings", userId, tenantId]` (or `["settings"]` + `queryClient.clear()` in logout — see UI-001), set `refetchOnMount: true`, and `localStorage.removeItem(TENANT_KEY)` in `logout()`.

### [UI-007] Member-facing deposit history lists the whole club's deposits (no `enabled` guard) — Severity: High
- **Location:** `components/deposits/deposit-request-view.tsx:73-90`
- **Evidence:**
```tsx
const linkedMemberUuid = useMemo(() => { … membersQuery.data?.find((m) => m.email?.toLowerCase() === email)?.id ?? null; },
  [user?.email, memberId, membersQuery.data]);
const effectiveMemberId = memberId ?? linkedMemberUuid;
const history = useDepositsList({ page: 1, pageSize: 20, search: "", memberId: effectiveMemberId, fundId: null, status: null, startDate: null, endDate: null });
// no `enabled: effectiveMemberId !== null`
```
- **Impact:** On first paint (members not yet loaded) and permanently whenever the email match fails (admin-created member without a matching profile email, or the members query erroring), `memberId` is `null` → the request is unfiltered and the **entire club's deposit ledger** renders on a member-facing page. It is also cached under `["deposits",{memberId:null,…}]`, so the unfiltered set is reused by anything else hitting that key.
- **Fix:** `enabled: effectiveMemberId != null` (pass the flag through `useDepositsList`) and render a skeleton/"identify yourself" state until resolved; the history list is also missing pagination controls for its 20-row cap.
- **Needs verification:** confirm the server ignores a missing `memberId` for this role (i.e. returns all rows) — the UI already assumes that.

### [UI-008] Attendance roster never loads saved attendance; partial save; whole club shown ABSENT — Severity: High
- **Location:** `components/meetings/meeting-attendance-modal.tsx:42-59, 61, 87-99, 105-113, 121-126, 159`
- **Evidence:**
```tsx
// :42 — seeded ONCE, at the moment the parent still passes meeting === null and members === []
const [records, setRecords] = useState<Record<string, {…}>>(() => {
  const map = {};
  if (meeting?.attendees?.length) { meeting.attendees.forEach(…) } else { members.forEach((m) => { map[m.id] = { attendanceStatus: "ABSENT" }; }) }
  return map;                                  // → {} on first render, never rebuilt
});
const [meetingNotes, setMeetingNotes] = useState(meeting?.notes || "");   // :61 same bug
…
const currentStatus = records[member.id]?.attendanceStatus || "ABSENT";   // :159
const payload = Object.entries(records).map(…)                            // :90 → only touched rows
```
- **Impact:** Because there is no `useEffect` keyed on `meeting`/`members`, `records` stays `{}` after the first open: every roster row reads as **ABSENT** (the summary at :121-126 reports "Absent: 40"), the previously saved attendance and meeting notes are invisible, and "Save attendance" persists an empty/partial payload while the screen claims 40 absentees. `handleComplete` (:105) then finalises the meeting on top of that data.
- **Fix:** `useEffect(() => setRecords(seed(meeting, members)), [meeting?.id, members])` and build the payload from the full roster (`members.map(...)` merged with `records`), not from `records` alone. Wrap `handleSave`/`handleComplete` in `try/catch` (see UI-045).
- **Needs verification:** server handling of omitted members in the attendance payload (does it default to ABSENT or keep the stored value?).

### [UI-009] Errors swallowed inside `queryFn` → "no data" tables and `৳0.00` KPI cards presented as real — Severity: High
- **Location:** `app/transactions/page.tsx:38-58`; `app/governance/page.tsx:34-60`; `app/goals/page.tsx:22-42`; `app/projects/page.tsx:36-60`; `components/expenses/expenses-view.tsx:63-75`; `components/dividends/dividends-view.tsx:63-72`
- **Evidence:**
```tsx
// app/transactions/page.tsx:38
queryFn: async (): Promise<TxList> => {
  try { const res = await apiClient<…>("/finance/transactions", { params }); return { data: res.data ?? [], meta: { total: 0, page, limit, pages: 1 } }; }
  catch (err: any) { toast.error(err?.message ?? "Failed to load transactions"); return { data: [], meta: {…} }; }   // ← query resolves SUCCESS
}
```
- **Impact:** `throw`ing is the only way to get `isError`; these fetchers return success-with-zeros, so `isError` is permanently false, the retry-once policy never engages, and the user sees "No transactions match your filters" / "৳0.00 collected" instead of an error. The toast also re-fires on every background refetch. For the finance screens this is indistinguishable from "your club collected nothing this month".
- **Fix:** remove the `catch` (or rethrow after toasting once in an effect), and derive the empty vs error branch from `query.isError` as `AuditLogsView` already does (`audit-logs-view.tsx:298`).

### [UI-010] Admin overview reports a failed API as "All tenants healthy" — Severity: High
- **Location:** `app/admin/page.tsx:39-58, 105-112`
- **Evidence:**
```tsx
const { data: tenantsData, isLoading: tenantsLoading } = useQuery<TenantListResponse>({ queryKey: ["admin","tenants",…], … });  // no isError
const rows = billingData?.data ?? [];
const totalTenants = tenantsData?.meta.total ?? rows.length;      // → 0 on failure
…
) : attention.length === 0 ? (
  <p …>{t("admin.overview.allClear", { defaultValue: "All tenants healthy. No action required." })}</p>
```
- **Impact:** A 500 or a revoked superadmin token renders four "0" metric cards and a green **"All tenants healthy. No action required."** banner. A platform operator is told there is nothing to do precisely when the console is blind.
- **Fix:** read `isError` from both queries, render a `role="alert"` retry panel, and only show the all-clear state when both queries succeeded.

### [UI-011] Deposit mutations invalidate only `["deposits"]` — fund balances, member contributions and dashboard stay stale — Severity: High
- **Location:** `components/deposits/deposit-modal.tsx:123`; `components/deposits/bulk-deposit-modal.tsx:110`
- **Evidence:**
```ts
queryClient.invalidateQueries({ queryKey: ["deposits"] });   // that's all
```
- **Impact:** Recording a deposit moves money into a fund. After the success toast the user is still looking at the **old fund balance** (`["funds", …]`), the **old contributed total** on the member profile (`["members", …]`), the old dashboard/analysis stats (`["analytics","stats"]`) and stale governance/goal figures. With `refetchOnWindowFocus: false` and 30 s staleTime, the wrong numbers persist until a manual reload. Finance `DELETE`/review mutations in `deposits-list-view.tsx` have the same gap.
- **Fix:** `queryClient.invalidateQueries({ queryKey: ["deposits"] }); queryClient.invalidateQueries({ queryKey: ["funds"] }); queryClient.invalidateQueries({ queryKey: ["members"] }); queryClient.invalidateQueries({ queryKey: ["analytics"] });` (or one `predicate` covering all), and re-check the remaining finance mutations for the same omission.

### [UI-012] "Cumulative"/"Total" KPIs are summed over the current page (or a capped subset) — Severity: High
- **Location:** `components/dividends/dividends-view.tsx:100-103`; `components/expenses/expenses-view.tsx:112-115`; `components/funds/funds-view.tsx:156-181` + `components/funds/shared.ts:25-40`
- **Evidence:**
```ts
// dividends-view.tsx:100 — page-scoped sum presented as "Total Revenue"
const totalDistributedAmount = rows.reduce((acc, r) => acc + parseFloat(String(r.totalDividend ?? 0)), 0);
…
label="Total Revenue" value={formatMoney(totalDistributedAmount, "BDT")}   // :154/:223 "BDT" hardcoded
```
```ts
// funds/shared.ts:29 — the list the KPI is computed from is capped at 100 rows
const res = await apiClient<PaginatedResponse<FundRow>>("/funds", { params: { …, limit: 100 } });
```
- **Impact:** With 300 deposits this month the "Total Revenue" card shows page 1 only; the funds screen's "Total Treasury" is the sum of ≤100 funds and **changes whenever a type/status filter is applied** (it is computed from the filtered `funds` array, not the tenant's treasury). Governance's `metrics.totalDeductions` has the same in-page accumulation. These are the numbers a treasurer reconciles against.
- **Fix:** request aggregate totals from the server (`meta`/dedicated totals endpoint) for these cards; never sum a paginated slice. Label a page-scoped figure as such, or remove it. Use integer cents, not `parseFloat` accumulation (Rule §12).

### [UI-013] Currency is hardcoded or defaulted to BDT across the finance screens — Severity: High
- **Location:** `components/dividends/dividends-view.tsx:154, 223, 317`; `components/expenses/expenses-view.tsx:157, 235, 342`; `components/dashboard/dashboard-view.tsx:44, 376`; `components/transactions/transactions-list-view.tsx:155`; `components/transactions/voucher-drawer.tsx:82`; `lib/formatters.ts:10`; goals/governance/projects views (`formatMoney(x)` with one arg)
- **Evidence:**
```ts
// lib/formatters.ts:8 — the default silently overrides the tenant's base currency
export const formatMoney = (amount, currencyCode: string = "BDT", options?) => …
```
```tsx
// dividends-view.tsx:154 / expenses-view.tsx:235
value={formatMoney(totalDistributedAmount, "BDT")}   // hardcoded, ignores useTenantCurrency()
```
- **Impact:** A tenant with `financial.baseCurrency = "USD"` sees BDT on Dividends, Expenses, Transactions, Goals, Governance, Projects and the **printed voucher**, while Deposits/Funds correctly use the tenant currency. Money is labelled in the wrong currency — worse than a missing symbol, because the figure is read as authoritative.
- **Fix:** make the currency argument mandatory (drop the `"BDT"` default in `formatMoney`), route every call through `useTenantCurrency()`/`useTenantDateFormat()`, and grep-gate `, "BDT")` in CI.

### [UI-014] Page number is not reset when filters change (governance, goals, projects, meetings) — Severity: High
- **Location:** `components/governance/governance-view.tsx:383-419`; `components/goals/goals-view.tsx` (search/filter handlers); `components/projects/project-list-view.tsx` (search/status); `components/meetings/meetings-list-view.tsx` (search/status)
- **Evidence:**
```tsx
// governance-view.tsx — filter setters update the query but not the page
onChange={(v) => setSelectedTier(v)}        // no setCurrentPage(1)
onSearchChange={setSearchQuery}             // no setCurrentPage(1)
…
<ERPDataTable page={currentPage} totalCount={total} onPageChange={setCurrentPage} … />
```
- **Impact:** Filter a list down to 2 pages while sitting on page 5 → the table renders "20–24 of 12"-style nonsense/empty rows with an enabled-looking footer; the user must discover and press "previous" four times. `DepositsListView`, `MembersListView` and `AuditLogsView` do this correctly (`deposits-list-view.tsx:181-186`) — these four screens regressed from that pattern.
- **Fix:** reset the page in every filter/search/pageSize handler (single `useEffect` on `[search, filters]` is the least error-prone form).

### [UI-015] No focus trap or focus restore in any modal or sheet — Severity: High
- **Location:** `components/ui/top-sheet.tsx:85-94, 105-112`; `components/ui/app-modal.tsx:130-150`; `components/ui/erp-confirm-dialog.tsx`; `components/ui/session-timeout-dialog.tsx`
- **Evidence:**
```tsx
// top-sheet.tsx:85
<div role="dialog" aria-modal="true" aria-label={title} className={cn("relative z-[101] w-full flex flex-col max-h-[92vh] …")}>
```
- **Impact:** `aria-modal` is declared but nothing enforces it: focus stays on the trigger behind the overlay, `Tab` walks the whole page underneath, and on close focus is lost to `<body>` (a keyboard user restarts at the top of the document). For the session-timeout dialog this is worse — the "Stay signed in" button is unreachable by keyboard while the countdown runs, so the user is logged out.
- **Fix:** on open, move focus to the first focusable element/`role="dialog"` container (`tabIndex={-1}`); trap `Tab`/`Shift+Tab`; on close restore focus to the trigger. `inert` on the background subtree is the modern shortcut.

### [UI-016] Sortable table headers are mouse-only — Severity: High
- **Location:** `components/ui/erp-data-table.tsx:107-124`
- **Evidence:**
```tsx
<th key={col.key} className={cn(…, isSortable && "cursor-pointer hover:text-foreground transition-colors group", col.className)}
    onClick={isSortable ? () => onSort(col.key) : undefined}
    aria-sort={…}>
```
- **Impact:** The header carries `aria-sort` (telling AT it is a sort control) but is not focusable and has no `role="button"`/`onKeyDown` — keyboard and switch users cannot sort at all on Deposits, Members, Audit, Meetings, Projects, Governance.
- **Fix:** render a real `<button type="button">` inside the `<th>` (add `scope="col"` while you are there), or add `tabIndex={0} role="button" onKeyDown={e => (e.key === "Enter" || e.key === " ") && onSort(col.key)}`.

### [UI-017] Urdu sets `dir="rtl"` but the entire UI is built with physical Tailwind utilities — Severity: High
- **Location:** `lib/i18n.tsx:70`; `app/globals.css` (no `rtl`/`[dir]` rules — verified by grep); `components/layout/app-shell.tsx:79`; `components/layout/sidebar.tsx:152-166`; `components/ui/erp-data-table.tsx:99-104`; `analysis-view.tsx:433, 488, 533`
- **Evidence:**
```ts
// lib/i18n.tsx:70
document.documentElement.setAttribute("dir", locale === "ur" ? "rtl" : "ltr");
```
```tsx
// app-shell.tsx:79 — physical padding, sidebar is `fixed left-0`
sidebarCollapsed ? "pl-[68px]" : "pl-[260px]",
// sidebar.tsx:152-166 — search icon absolute left-2.5, input pl-8/pr-8, clear button right-2
```
- **Impact:** In Urdu the document flips to RTL (text and native controls mirror) while every layout box does not: the fixed sidebar stays pinned left, the main column keeps `pl-[260px]`, the search icon overlaps the text, money columns stay `text-right` (line 103), table headers don't mirror, and dropdown panels are anchored `left-0`/`right-0` in the wrong corner. The locale is offered in the header switcher, so this is user-reachable — the app looks broken in one of its four mandatory locales.
- **Fix:** either ship a mirrored stylesheet (logical properties: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, `[dir="rtl"]` overrides) or drop `dir="rtl"` and document Urdu as LTR until mirroring lands.

### [UI-018] Fixed 260px sidebar with no off-canvas/drawer — the app is unusable on phones — Severity: High
- **Location:** `components/layout/sidebar.tsx:99-102`; `components/layout/app-shell.tsx:76-80`; `components/admin/admin-shell.tsx:115-117`
- **Evidence:**
```tsx
// sidebar.tsx:100
"fixed left-0 top-0 z-40 flex h-screen flex-col border-r …", collapsed ? "w-[68px]" : "w-[260px]"
// app-shell.tsx:38-43
useEffect(() => { const update = () => setSidebarCollapsed(window.innerWidth < 1024); update(); window.addEventListener("resize", update); … }, []);
```
- **Impact:** On a 375px viewport the sidebar is still fixed (68px collapsed), the content area is offset by `pl-[68px]`, and the only control is a 28px collapse chevron. `AdminShell` is worse: a hard `w-[240px]` sidebar with no breakpoint, leaving ~135px of content. There is no hamburger, no overlay, and no drawer anywhere in the tree.
- **Fix:** hide the sidebar below `lg` and add a header hamburger that toggles an overlay drawer (`translate-x-0` + scrim, focus-trapped); stop the `resize` listener from overriding the user's manual collapse.

### [UI-019] Rejected deposits render as a green "REJECTED" badge with an untranslated raw enum — Severity: High
- **Location:** `components/members/member-detail-sheet.tsx:184` (deposit history status cell)
- **Evidence:**
```tsx
<StatusBadge tone="emerald">{d.status}</StatusBadge>     // tone fixed; text = raw DB enum
```
- **Impact:** A rejected (or pending, or soft-deleted) deposit shows in success green with an uppercase raw enum such as `REJECTED`/`PENDING` — a colour-only status signal pointing the wrong way in a member's financial history. Compare `depositStatusTone()` used correctly in `deposits-list-view.tsx` and `deposit-request-view.tsx:173`.
- **Fix:** `tone={depositStatusTone(d.status)}` and `t(\`deposits.status${…}\`)`; keep the raw enum out of the DOM.
- **Needs verification:** confirm the exact cell line (the sheet is the only member-history table with a hardcoded tone).

### [UI-020] Native `confirm()` for destructive deletes, with no pending guard — Severity: High
- **Location:** `components/goals/goals-view.tsx:220`; `components/projects/project-list-view.tsx:238`; `components/meetings/meetings-list-view.tsx:210`; `components/meetings/meeting-attendance-modal.tsx:102`
- **Evidence:**
```tsx
// goals-view.tsx:220
if (confirm(t("goals.confirmDelete", { defaultValue: "Delete this goal?" }))) {
  onDeleteGoal(g.id);        // fire-and-forget; mutateAsync rejects → unhandled rejection
}
```
- **Impact:** The app ships `ERPConfirmDialog` (styled, i18n'd, portaled) but these four flows use the browser dialog: it blocks the main thread, cannot be styled or translated consistently, and — because the handler isn't awaited or guarded by a pending flag — a double click (or Enter twice) fires two `DELETE`s. The resulting rejections are unhandled console errors, not toasts.
- **Fix:** use `ERPConfirmDialog`/`ERPConfirmDialog`-equivalent with `isPending` disabling the confirm button and `try/catch` around the `mutateAsync`.

### [UI-021] Financial/destructive actions commit with no confirmation — Severity: High
- **Location:** `components/dividends/dividend-distribution-modal.tsx` (Authorize/Pay distribution buttons, `mutationFn: () => apiClient("/dividends/distribute", …)`); `components/funds/fund-transfer-modal.tsx` (`onSubmit`); `app/settings/page.tsx:287-296` (`SaveBar` for governance/penalty rules)
- **Evidence:**
```tsx
// fund-transfer-modal.tsx — no confirmation between preview and commit
const res = await apiClient("/funds/transfer", { method: "POST", body: JSON.stringify({ fromId, toId, amount, note }) });
queryClient.invalidateQueries({ queryKey: ["funds"] });
```
- **Impact:** A single click moves money between funds, distributes dividends to every member, and rewrites governance rules that generate future penalties — with no summary of the irreversible effect, no undo and no `ERPConfirmDialog`, while the app *has* that component and uses it elsewhere.
- **Fix:** confirm each with the exact figures in the dialog body (amount, from → to, member count) and disable while pending.

### [UI-022] UI-side permission gating is missing or hardcoded on finance writes — Severity: High
- **Location:** `app/transactions/page.tsx` (`canManage={true}` hardcoded into `TransactionsListView`); `components/expenses/expenses-view.tsx` (Record Expense button ungated); `components/governance/governance-view.tsx` (Issue Penalty ungated); `components/goals/goals-view.tsx` (create/delete ungated)
- **Evidence:**
```tsx
// app/transactions/page.tsx — everyone is a manager
<TransactionsListView … canManage={true} />
```
- **Impact:** A read-only Auditor/Member sees destructive controls (soft-delete a transaction, post an expense, issue a penalty, delete a goal) that only fail after a round-trip with a 403 toast. `usePermissions()` exists (`lib/use-permissions.ts:16`) and Deposits uses it correctly — this is an inconsistency, not a missing capability.
- **Fix:** `const { can } = usePermissions(); can("TRANSACTIONS","WRITE")` (and the equivalent per screen) as the single source for both visibility and `disabled`.
- **Needs verification:** server-side enforcement exists for these routes (believed yes, not audited here).

### [UI-023] Password-reveal control is removed from the tab order — Severity: High
- **Location:** `app/register/page.tsx:177-186`
- **Evidence:**
```tsx
<button type="button" onClick={() => setShowPassword(!showPassword)}
  aria-label={showPassword ? "Hide password" : "Show password"}   // hardcoded English
  tabIndex={-1}>                                                     // ← unreachable by keyboard
  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
```
- **Impact:** A keyboard-only user cannot reveal the password they are about to set, and cannot type the confirmation without re-reading it character by character. `aria-label` is English in all four locales.
- **Fix:** drop `tabIndex={-1}` (or wire `aria-pressed`), and route the label through `t()`.

### [UI-024] The printable member voucher is 100% hardcoded English, BDT and DD/MM/YYYY — Severity: High
- **Location:** `components/transactions/voucher-drawer.tsx:44-137`
- **Evidence:**
```tsx
<p className="text-xs text-muted-foreground">Financial Voucher</p>                     // :63
{formatMoney(Number(voucher.amount))}                                                   // :82 → BDT default
{formatDate(voucher.date)}                                                              // :71 → hardcoded DD/MM/YYYY
<span …>Beneficiary / Member</span> … {voucher.category || "General Operations"}         // :111-114
<span …>Cryptographically Audited Transaction</span> … "ERP Immutable Receipt"            // :134-136
```
- **Impact:** This is the artifact printed and handed to members: every label, every fallback value and the amounts are English + BDT + `DD/MM/YYYY` regardless of the tenant's locale, currency and date format. Bengali/Urdu/Hindi members and USD tenants get a document in the wrong language and wrong currency.
- **Fix:** every string through `t()`, amounts through `useTenantCurrency()`, dates through `useTenantDateFormat()`; remove the invented "Cryptographically Audited / Immutable Receipt" claims unless a signature exists.

### [UI-025] Field labels are reused as error messages — Severity: Medium
- **Location:** `components/deposits/deposit-modal.tsx:28-29, 156, 182`; `components/deposits/deposit-request-view.tsx:208, 228`; `app/register/page.tsx:158, 169`; `app/login/page.tsx:143`
- **Evidence:**
```ts
// deposit-modal.tsx:25-29 — the Zod message IS the string "amount"
amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "amount").refine((v) => parseFloat(v) > 0, "amount"),
…
error={errors.amount?.message}                       // :156 → renders literally "amount"
…
{monthError && <p role="alert" …>{t("deposits.modal.month")}</p>}   // :182 → "Month" as the error
```
- **Impact:** The user is told the error is "amount" or "Month" — no indication of what to fix. Same pattern in the request form (`t("deposits.modal.amount")` as the amount error, `t("requestDeposit.trxId")` as its own error).
- **Fix:** proper message keys (`z.string(…, "errors.invalidAmount")` → `t("deposits.errors.invalidAmount")`), and a dedicated `deposits.errors.monthRequired` string for :182.

### [UI-026] Shared table footer and page controls are hardcoded English in every locale — Severity: Medium
- **Location:** `components/ui/erp-data-table.tsx:237-289`
- **Evidence:**
```tsx
{totalCount === 0 ? "0 of 0" : `${startRow}–${endRow} of ${totalCount}`}   // :240
…
<span …>Page {page} of {totalPages}</span>                                  // :278
```
- **Impact:** The labels next to them *are* translated (`rowsPerPageLabel`, `previousPageLabel`, `nextPageLabel` via `t()` at :71-73), so in Bengali/Urdu/Hindi the footer reads a translated label next to an English sentence, with an en-dash and Western digits. This footer is on every list in the product.
- **Fix:** `t("erp.dataTable.range", { start, end, total })` / `t("erp.dataTable.pageOf", { page, pages })`; pass numerals through `Intl.NumberFormat(locale)`.

### [UI-027] Raw Zod messages and English `defaultValue` fallbacks reach the UI — Severity: Medium
- **Location:** `app/login/page.tsx:143`; `app/register/page.tsx:158, 169, 203`; `components/members/member-form-modal.tsx` (field error mapping)
- **Evidence:**
```tsx
const fieldError = errors.email?.message || errors.password?.message;   // login:143 → "Invalid email"
```
- **Impact:** Zod's default English messages ("Invalid email", "String must contain at least 12 character(s)") are displayed verbatim on a 4-locale product. `t(key, { defaultValue: "…" })` is used correctly in newer code, so these are legacy leftovers.
- **Fix:** map field errors to message keys (the pattern already used elsewhere: `errors.memberId ? t("deposits.modal.selectMember") : undefined`).

### [UI-028] `router.replace()` called during render — Severity: Medium
- **Location:** `app/settings/page.tsx:142-145`; `app/register/page.tsx:97-100`
- **Evidence:**
```tsx
if (!authLoading && !user) {
  router.replace("/login?redirect=/settings");   // in the render body, not an effect
  return null;
}
```
- **Impact:** Mutating the router during render is a React anti-pattern: it schedules a navigation as a side effect of rendering, and any re-render before the redirect lands re-fires it (React 19 also warns in dev). If the profile request resolves to `null` for a network blip, the user is bounced to login.
- **Fix:** `useEffect(() => { if (!authLoading && !user) router.replace(...) }, [authLoading, user])`.

### [UI-029] Modal open/close timer is never cleared (`requestAnimationFrame` return discarded) — Severity: Low
- **Location:** `components/ui/app-modal.tsx:38-58`
- **Evidence:**
```tsx
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    setAnimationState("entering");
    const timer = setTimeout(() => setAnimationState("open"), ANIMATION_DURATION);
    return () => clearTimeout(timer);      // rAF callbacks ignore return values → never runs
  });
});
```
- **Impact:** A 200 ms timer survives unmount and can flip `animationState` back to `"open"` after the close path set `"exiting"/"closed"` (masked today by the `if (!isMounted) return null` guard at :74, so the visible symptom is a state glitch, not a stuck modal). `isMounted` in the dep array at :58 also re-runs the whole effect on every open/close.
- **Fix:** hoist the timer into a `useRef` and clear it in the effect cleanup; drop `isMounted` from the deps by using a functional guard.

### [UI-030] `document.body.style.overflow = "unset"` on overlay teardown — nested overlays re-enable background scroll — Severity: Medium
- **Location:** `components/ui/top-sheet.tsx:62-71`; `components/ui/app-modal.tsx:48, 54, 62`; `components/ui/erp-confirm-dialog.tsx:50, 56`; `components/ui/session-timeout-dialog.tsx:35, 37`
- **Evidence:**
```ts
document.body.style.overflow = "hidden";
return () => { document.body.style.overflow = "unset"; … };   // "unset", not the previous value
```
- **Impact:** Any stack of two overlays (sheet → confirm dialog, sheet → modal) breaks scroll-locking: closing the inner one resets `overflow` to `unset` while the outer is still open, so the page scrolls behind a "locked" dialog. It also stomps any pre-existing body overflow value set by a third component.
- **Fix:** a single `useScrollLock()` helper with a counter, saving/restoring the previous inline value.
- **Needs verification:** confirm a live nested pair (e.g. `MemberDetailSheet` + `MemberFormModal`, or `DepositModal` + `ERPConfirmDialog`) — no error-boundary is present to catch the class of breakage.

### [UI-031] Inactivity timeout fires `onLogout` twice — Severity: Medium
- **Location:** `hooks/use-inactivity-timeout.ts:49-64`
- **Evidence:**
```ts
countdownTimer.current = setInterval(() => {
  const remaining = Math.max(0, warningDurationMs - (Date.now() - start));
  setTimeRemaining(Math.ceil(remaining / 1000));
  if (remaining <= 0 && countdownTimer.current) { clearInterval(countdownTimer.current); onLogoutRef.current(); }   // path A
}, 100);
warningTimer.current = setTimeout(() => { onLogoutRef.current(); }, warningDurationMs);                        // path B
```
- **Impact:** Both paths fire at the same instant. The first is never cleared by the other, so the app issues **two `POST /api/auth/logout`** requests and two `router.push`es (`app-shell.tsx:54-56` passes `onLogout: () => void handleLogout()`), producing a duplicate navigation/refresh.
- **Fix:** keep a single `logoutFired` ref guard, or clear both timers from one `fireLogout()` helper.

### [UI-032] Ref mutated during render — Severity: Low
- **Location:** `hooks/use-inactivity-timeout.ts:33-34`
- **Evidence:**
```ts
const onLogoutRef = useRef(onLogout);
onLogoutRef.current = onLogout;      // every render, including the first (before commit)
```
- **Impact:** Under concurrent rendering a render that is thrown away can still leave a value a later commit observes. Harmless with this hook today, but it is the pattern the audit brief calls out.
- **Fix:** `useEffect(() => { onLogoutRef.current = onLogout })`.

### [UI-033] Search is un-debounced on 5 of 8 list screens — Severity: Medium
- **Location:** `app/transactions/page.tsx:122-125`; `components/dividends/dividends-view.tsx:261`; `components/expenses/expenses-view.tsx:273`; `components/goals/goals-view.tsx`; `components/projects/project-list-view.tsx`
- **Evidence:**
```tsx
// transactions/page.tsx:122 — every keystroke changes the query key
onSearchChange={setSearch}      →   useQuery({ queryKey: ["finance","transactions",{ search, … }] })
```
```tsx
// the correct pattern already exists three times
// deposits-list-view.tsx:180-186 / members-list-view.tsx:191-197 / audit-logs-view.tsx:80-86
useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400); return () => clearTimeout(timer); }, [searchInput]);
```
- **Impact:** One HTTP request (plus one for the totals endpoint) per keystroke, and out-of-order responses are re-rendered by TanStack's cache-per-key churn — visible flicker and load on a remote DB.
- **Fix:** extract the debounce into a `useDebouncedValue` hook and use it on all list screens.

### [UI-034] Stale form state persists between opens (penalty, waive, meeting, project update, fund transfer) — Severity: Medium
- **Location:** `components/governance/issue-penalty-modal.tsx` (member/title/type/deduction `useState`, no reset on `onClose`); `components/governance/waive-penalty-modal.tsx:32-42`; `components/meetings/meeting-form-modal.tsx:38-56`; `components/projects/project-update-modal.tsx:24-28`
- **Evidence:**
```tsx
// issue-penalty-modal.tsx — state is created once; onClose does not reset
const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
const [title, setTitle] = useState("Verbal Warning for Non-Compliance");
const [deductionAmount, setDeductionAmount] = useState("");
// waive-penalty-modal.tsx:42
} catch (err: any) { toast.error(…) }     // reason text also survives the close
```
- **Impact:** Reopening "Issue Penalty" shows the previous member, reason and amount with Submit enabled — a second click can re-issue the same penalty without the officer re-reading it. Same for the meeting and project-update forms.
- **Fix:** reset on open (`useEffect(..., [isOpen])` or a `key` on the modal), as `DepositModal`/`FundModal` already do (`deposit-modal.tsx:97-102`).

### [UI-035] Fund transfer can start from the wrong source fund — Severity: Medium
- **Location:** `components/funds/fund-transfer-modal.tsx:43` (and the `close()` handler)
- **Evidence:**
```tsx
const [sourceId, setSourceId] = useState<string | null>(presetSourceId ?? null);   // initialised once
// close(): setSourceId(presetSourceId ?? null);  // reads the prop at close time
```
- **Impact:** The modal is always mounted by `FundsView`. `presetSourceId` is never synced into `sourceId` (no effect on `[presetSourceId]`), so after a transfer from fund A the next transfer opened **from fund B** can still carry `sourceId = A`: the sheet opens pre-filled with the wrong source and `fromId` in the POST body is the wrong fund. Money moves out of the fund the officer did not select.
- **Fix:** `useEffect(() => { if (open) setSourceId(presetSourceId ?? null) }, [open, presetSourceId])`, or key the sheet on the selected fund.

### [UI-036] `NaN`/`Infinity` can reach the UI — Severity: Medium
- **Location:** `lib/formatters.ts:13-15`; `components/goals/goals-view.tsx:158-163`; `components/projects/project-detail-view.tsx:123-128`
- **Evidence:**
```ts
// formatters.ts:14-15 — Infinity is not rejected (isNaN(Infinity) === false)
const num = typeof amount === "string" ? parseFloat(amount) : amount;
if (isNaN(num)) return "-";
```
```tsx
// goals-view.tsx:160
const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
… <div style={{ width: `${pct}%` }} />        // undefined target → NaN% renders as an empty/zero bar
```
- **Impact:** A divide-by-zero / missing target yields `NaN%` in the text and an invalid `width: NaN%` inline style; a `null` amount from the API renders the literal `BDT ∞`. The screen shows a progress bar with no explanation rather than an error.
- **Fix:** `if (!Number.isFinite(num)) return "-"` in `formatMoney`; guard both operands (`Number(g.targetAmount) > 0 && Number.isFinite(...)`) and render an explicit "—" state.

### [UI-037] Negative amounts get a double sign — Severity: Medium
- **Location:** `components/transactions/transactions-list-view.tsx:155`; `components/expenses/expenses-view.tsx:157`; `components/projects/project-detail-view.tsx:90`; `components/governance/governance-view.tsx:180-183`; `components/analysis/analysis-view.tsx:317-318`
- **Evidence:**
```tsx
{isPositive ? "+" : "-"}{formatMoney(item.amount, currency)}    // Intl already emits "-"
```
- **Impact:** For any negative row (refund, reversal, negative adjustment) the cell renders `-BDT -500.00` / `--৳500.00`. Money sign handling is duplicated at 5 call sites while `Intl.NumberFormat` already owns it.
- **Fix:** drop the manual sign and pass `signDisplay: "exceptZero"` (or `currencySign: "standard"`) to `formatMoney`; keep a single formatter responsible for signs.

### [UI-038] KPI totals accumulated as floats — Severity: Medium
- **Location:** `components/dividends/dividends-view.tsx:100-103`; `components/expenses/expenses-view.tsx:112-115`; `components/governance/governance-view.tsx` (metrics accumulation); `components/projects/project-list-view.tsx` (spend total)
- **Evidence:**
```ts
const totalDistributedAmount = rows.reduce((acc, r) => acc + parseFloat(String(r.totalDividend ?? 0)), 0);
```
- **Impact:** `0.1 + 0.2`-style drift on ledger sums (AGENTS.md §12 requires integer-cents arithmetic; `deposits/shared.ts` already has `sumCents`/`centsToAmount` for exactly this). The wrong figure lands in the KPI the board reads.
- **Fix:** reuse `sumCents()` from `components/deposits/shared.ts` (or move it to `lib/money.ts`) for every aggregate.

### [UI-039] UTC/local date drift in defaults and formatters — Severity: Medium
- **Location:** `components/expenses/expense-modal.tsx:53, 140`; `components/reports/reports-view.tsx:56, 59-60`; `components/meetings/meeting-form-modal.tsx:40-46`; `lib/formatters.ts:53, 70, 81`
- **Evidence:**
```tsx
// expense-modal.tsx:53 — "today" computed in UTC
setDate(new Date().toISOString().slice(0, 10));
// reports-view.tsx:56
const [fiscalMonth, setFiscalMonth] = useState(new Date().toISOString().slice(0, 7));
```
```ts
// formatters.ts:81 — a date-only string is parsed as UTC midnight
const d = typeof date === "string" ? new Date(date) : date;
const day = String(d.getDate()).padStart(2, "0");
```
- **Impact:** In Bangladesh (UTC+6) an expense recorded before 06:00 is stamped with **yesterday's** date, and the Reports screen defaults to the previous month on the 1st after 00:00 local. `formatDatePattern("2026-09-27")` renders the 26th for any negative UTC offset.
- **Fix:** derive "today" from local parts (`getFullYear/getMonth/getDate`), and parse date-only strings component-wise (`new Date(y, m-1, d)`) in the formatters.

### [UI-040] Raw `<input type="date">` in 5 forms, contradicting the in-repo rule — Severity: Medium
- **Location:** `components/expenses/expense-modal.tsx:234`; `components/projects/project-form-modal.tsx:220, 229`; `components/goals/goal-form-modal.tsx:170`; `components/reports/reports-view.tsx:256, 264`; rule text at `components/ui/erp-date-picker.tsx:91`
- **Evidence:**
```ts
// components/ui/erp-date-picker.tsx:91
// ISO yyyy-mm-dd on the wire. Never a raw <input type="date">.
```
- **Impact:** The native picker renders `mm/dd/yyyy` (US order) regardless of the tenant's `DD/MM/YYYY` format and shows the browser/OS locale, so the same product looks like two different products in the same tenant; these fields are also invisible to the shared `ERPDatePicker` styling/a11y (grid keyboard nav).
- **Fix:** replace all five with `ERPDatePicker` (already used correctly in DepositModal, DepositRequestView, AuditLogsView); add a lint rule banning `type="date"`.

### [UI-041] Silent `0` defaults instead of validation on settings and penalty amounts — Severity: Medium
- **Location:** `app/settings/page.tsx:349-356, 464-466`; `components/governance/issue-penalty-modal.tsx` (`deductionAmount: parseFloat(deductionAmount) || 0`)
- **Evidence:**
```ts
// settings/page.tsx:349
const num = (v: string, fallback = 0): number => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n*100)/100 : fallback; };
…
withdrawalLimitPercent: num(fin.withdrawalLimitPercent, 0),   // cleared field ⇒ saved as 0
```
- **Impact:** Clearing "Withdrawal Limit %" or a Tier deduction amount and pressing Save writes **0** with no error — a 0% withdrawal limit or a 0-value `FUND_DEDUCTION` penalty rule is saved silently, with the success toast claiming the section was saved. The field is even marked `required` in the UI.
- **Fix:** validate required numerics client-side (Zod/RHF) and reject the save with a field error instead of coercing to `0`.

### [UI-042] Penalty titles are hardcoded English and persisted to the database — Severity: Medium
- **Location:** `components/governance/issue-penalty-modal.tsx` (`handleTierChange` → `setTitle("Tier 2 Governance Deduction")`; `title` sent in the POST body)
- **Evidence:**
```tsx
const handleTierChange = (tier: number) => { setTier(tier); setTitle(`Tier ${tier} Governance Deduction`); … };
```
- **Impact:** English strings become tenant data, so a Bengali officer's penalty records read in English forever in the ledger/governance list; and changing the penalty **type** in the dropdown does not update the title, so a `FUND_DEDUCTION` can be filed under the title "Verbal Warning".
- **Fix:** store a rule/type key and render the title through `t()` at display time; if free text is wanted, leave it empty by default and require the officer to type it.

### [UI-043] A failing mutation with no `onError` produces zero feedback — Severity: Medium
- **Location:** `app/goals/page.tsx:89-100`
- **Evidence:**
```ts
const updateProgressMutation = useMutation({
  mutationFn: async ({ goalId, newAmount }) => { await apiClient(`/goals/${goalId}`, { method: "PUT", body: JSON.stringify({ currentAmount: newAmount }) }); },
  onSuccess: () => { … },     // no onError
});
```
- **Impact:** A rejected progress update (403, validation, network) closes/keeps the UI exactly as if it succeeded — the officer believes the milestone was recorded. Same for the other update paths that only declare `onSuccess`.
- **Fix:** add `onError: (err) => toast.error(errMsg(err, t("common.errors.generic")))` to every mutation (this is the established pattern in the same file, :69-71 and :84-86).

### [UI-044] `mutateAsync` in non-awaited / `finally`-only handlers → unhandled rejections — Severity: Medium
- **Location:** `components/meetings/meeting-attendance-modal.tsx:87-99, 105-113`; `components/goals/goals-view.tsx:220`; `app/goals/page.tsx:117-122`; `app/governance/page.tsx` (`await mutateAsync` in a `try/finally`)
- **Evidence:**
```tsx
const handleSave = async () => { setIsSaving(true); try { … await onSaveAttendance(meeting.id, payload); } finally { setIsSaving(false); } };  // no catch
```
- **Impact:** The mutation's own `onError` shows a toast, but the `mutateAsync` promise still rejects → an unhandled rejection in the console on every failure; in `handleComplete` it also aborts the "finalise meeting" step silently after the attendance save fails.
- **Fix:** wrap in `try/catch` and rethrow only where a caller handles it; prefer `mutate()` with callbacks for fire-and-forget UI actions.

### [UI-045] Settings exposes only 2 of the 4 mandatory locales and stores non-locale values — Severity: Medium
- **Location:** `app/settings/page.tsx:618-631`
- **Evidence:**
```tsx
options={[ { value: "English", label: "English" }, { value: "Bengali", label: "Bengali" } ]}
onChange={(v) => { setSys(p => ({ ...p, language: v ?? "" })); if (v === "English") setLocale("en"); else if (v === "Bengali") setLocale("bn"); }}
```
- **Impact:** A superadmin cannot set Hindi or Urdu as the tenant default even though `LOCALES` ships 4 and the header switcher offers 4; the persisted value ("English"/"Bengali") is not a locale code, so the settings form and the header switcher can disagree (form shows "Bengali" while the UI is in `ur` from localStorage).
- **Fix:** drive the options from `LOCALES` with `LOCALE_LABELS`, persist the code (`"bn"`), and initialise `locale` from the setting when present.

### [UI-046] `<html lang="en">` is hardcoded; locale/`dir` are applied after hydration — Severity: Medium
- **Location:** `app/layout.tsx:63-66`; `lib/i18n.tsx:52-71`
- **Evidence:**
```tsx
// app/layout.tsx:63
<html lang="en" suppressHydrationWarning className={cn(jakarta.variable, …, "font-sans")}>
```
```ts
// lib/i18n.tsx:53-71 — locale starts at "en" and is read from localStorage in an effect
const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
```
- **Impact:** Every response is server-rendered as `lang="en"` with no `dir`; the Bengali/Urdu UI therefore renders English HTML first and swaps after hydration (visible flash and layout shift for Urdu's `dir` flip). Screen readers announce the wrong language until hydration, and `suppressHydrationWarning` hides the mismatch instead of fixing it.
- **Fix:** read the locale cookie server-side in the root layout and emit `lang`/`dir` + the right font class in the SSR HTML; the i18n provider then hydrates without a flash.

### [UI-047] Print output relies on a `fixed` portal with a dark scrim — Severity: Medium *(Needs verification)*
- **Location:** `components/transactions/voucher-drawer.tsx:38, 52`; `app/globals.css:296-307`
- **Evidence:**
```ts
const handlePrint = () => { window.print(); };
```
```css
@media print { .no-print, nav, aside, header { display: none !important; } body { background: #ffffff !important; color: #000000 !important; } }
```
- **Impact:** The voucher lives inside a `fixed inset-0` portal whose sibling scrim is `bg-black/60 dark:bg-black/80` (`top-sheet.tsx:79`). The print stylesheet hides nav/aside/header but has **no rule** for the fixed container or the scrim, so the printed page can come out with a black background, clipped, or on an extra blank page — on a document that is handed to members.
- **Fix:** add `@media print { .fixed, .backdrop-blur, #printable-voucher ~ * { position: static !important; } [data-overlay-scrim] { display: none !important; } }` and print only `#printable-voucher` (e.g. a print-only container with the rest of the app `hidden`).
- **Needs verification:** actually print a voucher in both themes and check the output/PDF page count.

### [UI-048] No error boundary anywhere in `app/` — Severity: Medium
- **Location:** `app/**` (verified: `app/**/{error,loading,not-found,global-error}.tsx` → **no matches**)
- **Impact:** Any render-time throw (see UI-003) or any unexpected `undefined` access blanks the whole route with no recovery path; the user must hard-reload and the app offers no report. This is what turns UI-003 from a broken dropdown into a white screen.
- **Fix:** add `app/global-error.tsx` (html/body-level), `app/error.tsx` with a `reset()` retry, and per-section `loading.tsx`.

### [UI-049] Pre-resolved member is invisible in the picker while the form is already valid — Severity: Medium
- **Location:** `components/deposits/deposit-request-view.tsx:73-79, 190-196, 208`
- **Evidence:**
```tsx
const effectiveMemberId = memberId ?? linkedMemberUuid;      // form validity uses effectiveMemberId
…
<AppDropdown options={memberOptions} value={memberId} … />   // display uses the raw state (null)
…
error={touched && !effectiveMemberId ? t("requestDeposit.selectMember") : undefined}
```
- **Impact:** The officer's own member is auto-resolved by email, the amount/method fields are filled, and **Submit is enabled** — but the "Member" field shows the placeholder and, on first touch, an "Select member" error, so the form looks broken while accepting the submission. The member who is being charged is never displayed on the screen.
- **Fix:** drive the dropdown from `effectiveMemberId` (and keep the resolution visible as a read-only "You" badge), and only show the error when no member can be resolved at all.
- **Needs verification:** whether the member picker should be restricted to the signed-in member (a member can currently pick **any** member and file a deposit request in their name). Confirm server-side ownership enforcement.

### [UI-050] Icon-only buttons without an accessible name, and one with no handler — Severity: Medium
- **Location:** `components/layout/top-nav.tsx:201-207`; `components/ui/app-dropdown.tsx:245-255`; `components/ui/session-timeout-dialog.tsx` (close control); `components/layout/sidebar.tsx:135-145` (has label ✔)
- **Evidence:**
```tsx
// top-nav.tsx:201 — a notifications control that does nothing
<button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl …" aria-label={t("layout.notifications", …)}>
  <Bell className="h-4 w-4" />
</button>
```
- **Impact:** The bell is a dead control (no `onClick`, no menu, no disabled state) that users will click expecting notifications. Elsewhere, the dropdown's search `<input>` and the session-timeout close button have no accessible name, so screen readers announce "edit".
- **Fix:** wire the bell to a notifications view or remove it; add `aria-label` to every icon-only control; set `aria-hidden` on purely decorative icons that already have a text sibling.

### [UI-051] Dropdowns are not keyboard-operable menus and have no Escape handling — Severity: Medium
- **Location:** `components/layout/top-nav.tsx:210-249, 142-189, 312-343`; `components/admin/admin-shell.tsx:226-267`
- **Evidence:**
```tsx
{localeOpen && (<div className="absolute right-0 top-full … w-44 …">…<button type="button" onClick={() => { setLocale(l); … }}>…</button>…</div>)}
```
- **Impact:** The three header dropdowns (locale, tenant, profile) open on click and close only on outside `mousedown`; there is no `role="menu"`/`aria-haspopup`, no arrow-key navigation, and **Escape does not close them** (Escape is only wired for overlays). A keyboard user can open one and is stuck once focus moves past the trigger; the trigger also lacks `aria-expanded` (only the profile button has it).
- **Fix:** add `aria-haspopup="menu"` + `aria-expanded`, `role="menu"`/`role="menuitem"`, roving focus, and an Escape keydown handler — or reuse a single shared popover primitive.

### [UI-052] Status conveyed by colour alone in the attendance roster — Severity: Medium
- **Location:** `components/meetings/meeting-attendance-modal.tsx:174-200`
- **Evidence:**
```tsx
<button type="button" onClick={() => handleStatusChange(member.id, "PRESENT")} className={`px-2.5 py-1 text-xs … ${currentStatus === "PRESENT" ? "bg-emerald-500 text-white" : "…"}`}>
```
- **Impact:** The selected attendance state is only a background colour change; no `aria-pressed`, no text, no icon. Screen-reader and colour-blind users cannot tell who is marked present — and those marks drive penalty generation.
- **Fix:** add `aria-pressed={currentStatus === "PRESENT"}` and a visible/`sr-only` label per state.

### [UI-053] Funds KPI cards recompute over the filtered set — Severity: Medium
- **Location:** `components/funds/funds-view.tsx:156-181`
- **Evidence:**
```tsx
const totalBalance = funds.reduce((sum, f) => sum + Number(f.balance ?? 0), 0);   // `funds` = filtered list
…
<ERPMetricCard label="Total Treasury" value={formatMoney(totalBalance, currency)} … />
```
- **Impact:** A card labelled "Total Treasury" / "Active Funds" changes value as soon as a type or status filter is applied, with no indication that it is filtered. Combined with the `limit: 100` cap (`funds/shared.ts:33`) and no pagination footer on that table, the number is unreliable and un-navigable.
- **Fix:** compute treasury KPIs from an unfiltered totals query and label the on-page card "Filtered total"; add server pagination to the funds table.

### [UI-054] Lists that ignore the shared data-table contract — Severity: Medium
- **Location:** `components/transactions/transactions-list-view.tsx` (columns without `sortable`, no `rowKey`); `components/funds/funds-view.tsx` (`<ERPDataTable>` with no `page`/`pageSize`/`totalCount`); `components/deposits/deposit-request-view.tsx:266-272` (fixed `pageSize: 20`, no footer); `components/audit/audit-logs-view.tsx` (compliant ✔)
- **Evidence:**
```tsx
// erp-data-table.tsx:87 — footer appears only when all three are supplied
const showFooter = page !== undefined && pageSize !== undefined && totalCount !== undefined;
// deposit-request-view.tsx:266
<ERPDataTable data={history.data?.data ?? []} columns={columns} isLoading={history.isLoading} rowKey={(r) => r.id} emptyMessage={…} />
```
- **Impact:** The Funds list and the member deposit history render up to 100/20 rows with **no footer, no page sizes and no `startRow–endRow of totalCount`** — violating the shared pattern in AGENTS.md; on Funds the user cannot reach funds 101+ at all. Transactions has no sortable headers (the rule requires them) and relies on the index-key fallback in `getKey` (`erp-data-table.tsx:75`).
- **Fix:** pass `page/pageSize/totalCount/onPageChange/onPageSizeChange` to both, add `sortable` + `onSort` to the transactions columns, and pass an explicit `rowKey` everywhere so the index fallback can never be used on a re-sortable list.

### [UI-055] Dead/no-op controls and duplicate routes — Severity: Low
- **Location:** `app/request-deposit/page.tsx:6-12` (identical to `app/deposits/request/page.tsx:6-12`); `app/meetings/page.tsx` → `onOpenLiveRoom` and `onOpenDetail` both call the same attendance modal; `components/meetings/meeting-form-modal.tsx:50` (`location` default `"HQ / Online"`); `components/expenses/expenses-view.tsx:106` (`"Other"` category)
- **Impact:** Two URLs render the same member-facing page (duplicate surface, duplicate analytics, ambiguous "which is canonical"), and one row-menu action is a no-op alias. A Bengali/Urdu user sees `"HQ / Online"` as the pre-filled meeting location.
- **Fix:** keep one route and redirect the other; delete the dead handler; move the default location into a `t()` key or leave it empty.

### [UI-056] Fabricated identity and static status chrome — Severity: Low
- **Location:** `components/layout/top-nav.tsx:286, 295, 301`; `components/admin/admin-shell.tsx:194-202`; `components/layout/sidebar.tsx:265`; `components/layout/sidebar.tsx:171-173`
- **Evidence:**
```tsx
{mounted && initials ? initials : "D"}                       // :286
{mounted && user?.name ? user.name : "Dr. Garrison Spinka"}  // :295  ← a fake person's name
{mounted && userRole ? userRole : "Admin"}                    // :301
```
```tsx
// admin-shell.tsx:195-200 — a live-looking health indicator wired to nothing
<span className="animate-ping absolute inline-flex … rounded-full bg-emerald-400 opacity-75" />
… "Platform Healthy"
```
- **Impact:** Before the profile query resolves (or if it fails), a signed-in user sees **"Dr. Garrison Spinka / Admin"** in the header. The admin footer pulses a green "Platform Healthy" that no health check feeds. `⌘K` is shown on Windows/Linux where the handler is `Ctrl+K`, and `v0.1.0` is hardcoded in two shells.
- **Fix:** render a skeleton instead of a placeholder identity; bind the health pill to a real `/admin/diagnostics` result or remove it; detect the platform for the shortcut hint; source the version from the build.

### [UI-057] Raw role/status enums rendered untranslated — Severity: Low
- **Location:** `components/layout/top-nav.tsx:129, 318`; `components/meetings/meetings-list-view.tsx` (status column); `components/governance/waive-penalty-modal.tsx` (`Tier {n} • {type}`); `components/transactions/voucher-drawer.tsx:79, 88, 91`; `app/settings/page.tsx:498-499`
- **Evidence:**
```tsx
const userRole = user?.role ? user.role.replace("_", " ") : "MEMBER";   // only the first underscore is replaced
```
- **Impact:** `FUND_MANAGER` renders as "FUND manager"; statuses show as `PENDING_VERIFIED`; the "SYSTEM" badge in the admin shell (`:129-131`) is English. A `replace("_", " ")` also mangles multi-word roles.
- **Fix:** `t(\`roles.${role}\`)` / `t(\`statuses.${status.toLowerCase()}\`)` with a `replaceAll("_", " ")` fallback for unmapped values.

### [UI-058] `key={index}` fallbacks in the shared table and metric card — Severity: Low
- **Location:** `components/ui/erp-data-table.tsx:75, 199`; `components/ui/erp-metric-card.tsx:168`
- **Evidence:**
```ts
const getKey = rowKey ?? ((item: any, idx: number) => item?.id ?? item?._id ?? idx);
```
- **Impact:** If a row has neither `id` nor `_id`, rows are keyed by position; on a re-sort or page change React reuses the wrong DOM/state (input focus, animation) across rows. `erp-metric-card`'s breakdown chips use `key={i}` over a sorted list.
- **Fix:** make `rowKey` required (it is cheap to pass) or warn in development when the index fallback is used; key breakdown chips by label.
- **Needs verification:** which production tables actually hit the index branch (most rows expose `id`; `ProjectUpdateRecord` is the likely candidate).

### [UI-059] Uncleared short timers — Severity: Low
- **Location:** `components/layout/sidebar.tsx:56`; `app/login/page.tsx:93`
- **Evidence:**
```tsx
setTimeout(() => searchInputRef.current?.focus(), 150);   // sidebar.tsx:56 — no cleanup
setTimeout(() => setShake(false), 500);                  // login/page.tsx:93 — no cleanup
```
- **Impact:** Both fire after unmount (harmless in React 19 — no warning, and the ref access is guarded), but they can steal focus ~150 ms after the sidebar collapses.
- **Fix:** store the timer id in a ref and clear it in the effect cleanup.

### [UI-060] `as any` casts hiding resolver/type mismatches — Severity: Low
- **Location:** `components/deposits/deposit-modal.tsx:77`; `components/members/member-form-modal.tsx:92`; `components/governance/issue-penalty-modal.tsx:148`; `components/reports/reports-view.tsx:210`; `components/ui/erp-data-table.tsx:75`
- **Evidence:**
```tsx
resolver: zodResolver(depositSchema) as any,   // deposit-modal.tsx:77
```
- **Impact:** The cast disables exactly the check that would catch a schema/form-type drift (the canonical source of "form validates but the API rejects"). `setType(val as any)` at issue-penalty:148 lets a dropdown option be written into a `string` state unchecked.
- **Fix:** align the zod input/output types (`z.input`/`z.output` with `zodResolver<Input, Context, Output>`) instead of casting; type dropdown `onChange` handlers as `(v: PenaltyType | null)`.

### [UI-061] Stale product comments and hardcoded route maps — Severity: Low
- **Location:** `components/layout/app-shell.tsx:21`; `components/layout/sidebar.tsx:148, 257`; `components/admin/admin-shell.tsx:116`; `components/layout/top-nav.tsx:35-55`
- **Evidence:**
```tsx
// app-shell.tsx:20-21
// Root application shell: fixed collapsible sidebar + sticky header + session timeout guard.
// Architectural port of Pathshala-Pro layout with InvestWise session management.
```
```ts
// top-nav.tsx:38-53 — route → i18n key map that silently defaults to the dashboard
return map[segment ?? ""] ?? "nav.dashboard";
```
- **Impact:** Comments from the deleted Vite SPA mislead future work (and the reviewer of this audit had to re-derive the layout). The breadcrumb map has no entry for `/admin/*`, `/audit`, `/deposits/request`, `/request-deposit` or `/expenses`… (only `deposits`/`transactions` are mapped), so those pages show **"Dashboard"** as their `<h1>` in the header — a wrong page title on `/audit` and `/request-deposit`.
- **Fix:** delete the legacy comments; derive the title from the nav model (`components/layout/navigation.ts`) instead of a hand-maintained map, and fall back to the route segment rather than `nav.dashboard`.

## Dead routes / broken links

| Item | Location | Status |
|---|---|---|
| `/request-deposit` and `/deposits/request` | `app/request-deposit/page.tsx:6-12`, `app/deposits/request/page.tsx:6-12` | Two live routes, byte-identical body (`<AppShell><DepositRequestView/></AppShell>`). Pick one, 301 the other. |
| Header breadcrumb for unmapped routes | `components/layout/top-nav.tsx:35-55` | `/audit`, `/admin/*`, `/request-deposit` render `nav.dashboard` → the page `<h1>` says "Dashboard". |
| Tenant pill on mobile | `top-nav.tsx:142, 191` (`hidden sm:block`) | On `< 640px` a superadmin cannot switch tenants at all (and per UI-002 switching does nothing anyway). |
| "Refresh" control wired to a wrong string | `components/audit/audit-logs-view.tsx:209` | `{t("members.refresh")}` — works, but shows another screen's string; a stale key reference that will break silently if `members.refresh` is removed. |
| `monthsLoading` prop | `components/ui/erp-fiscal-month-picker.tsx:26, 40` | Declared, never used — the month dropdown has no loading state. |
| `initialData` (edit) props | `components/projects/project-form-modal.tsx`, `components/meetings/meeting-form-modal.tsx` | Never passed by any caller; the prop-driven edit path is dead (and, per UI-005, broken if wired). |
| `onOpenLiveRoom` | `app/meetings/page.tsx` → `components/meetings/meetings-list-view.tsx` | Identical body to `onOpenDetail` — dead action. |
| `subscription/inactive`, `forgot-password` | `app/subscription/inactive/page.tsx`, `app/forgot-password/page.tsx` | Clean, no dead links. |

## i18n gaps

- **Key parity is healthy** — `npm run i18n:validate` → `i18n OK: 1379 keys identical across en, ur, hi, bn.` The defects are *usage* gaps.
- **Shared primitives bypass `t()`**: `erp-data-table.tsx:240` (`"0 of 0"`, `` `${start}–${end} of ${total}` ``) and `:278` (`"Page {page} of {totalPages}"`) — on every list in the product. `erp-metric-card` label/breakdown copy is caller-supplied, so it inherits the gaps below.
- **Fully hardcoded English screens/components**: `components/analysis/analysis-view.tsx` (entire screen: tabs, chart titles, axes, legends, table headers "Punctuality", "Cumulative Capital", "Equity Share %"), `components/transactions/voucher-drawer.tsx` (the printable member document), `components/ui/session-timeout-dialog.tsx` (the whole dialog), `components/governance/governance-view.tsx:143-154, 250` (`"ID:"`, `` `Tier ${p.tier}` ``, `` `${l.shares} Shares` ``), `components/projects/project-detail-view.tsx:160-187` (`"Handler:"`, `"of"`, `"entries"`, `"No description provided."`), `components/goals/goals-view.tsx:125, 169, 188` (`"Project:"`, `"Complete"`, `"No deadline"`), `components/dividends/dividends-view.tsx:108, 160, 178, 226-247` (`"Date"`, `"Fund"`, `"Status"`, `"Statutory Buffer"`, `"Clear Filters"`, `"Distributed in current view"`), `components/expenses/expenses-view.tsx:152, 190, 196-259` (`"Amount"`, `"Status"`, `"Clear Filters"`, `"Direct Disbursements"`, `"Outflow in current view"`, `"Other"`), `components/transactions/transactions-list-view.tsx:189, 198, 215, 222, 229` (`"N/A"`, `"General Treasury"`, `"Reference:"`, `title="Print Voucher"`, `title="Soft Delete"`), `components/transactions/soft-delete-modal.tsx:52, 67-77` (`"Type"`, `"Amount"`, `"Description"`, `"Confirm"`, `"Cancel"`, `"Type and reason are required."`), `components/deposits/bulk-deposit-modal.tsx:187` (`aria-label="Remove row"`), `components/ui/app-modal.tsx` / `top-sheet.tsx:108` (`aria-label="Close dialog"`), `components/goals/goal-form-modal.tsx:112, 132, 147` (placeholders), `app/settings/page.tsx:70-83` + `:498-499` (English `MONTHS` sent to the API; meeting-type chips shown raw), `app/admin/*` `defaultValue:` English fallbacks used where a key is missing at runtime.
- **Raw Zod messages displayed**: `app/login/page.tsx:143`, `app/register/page.tsx:158, 169, 203`; plus Zod messages that *are* label strings (`deposit-modal.tsx:28-29`).
- **Locale-blind formatting**: `lib/formatters.ts:21` hardcodes `new Intl.NumberFormat("en-US", …)` so all four locales get en-US grouping/decimal separators; `formatDatePattern` replaces only the first `DD`/`MM`/`YYYY` occurrence (`formatters.ts:87`); callers bypass it entirely with `toLocaleString()`/`toLocaleDateString("en-GB")` (`dashboard-view.tsx:44, 366`, `project-form-modal.tsx:46`).
- **Missing pluralization / interpolation risks**: `t()` interpolates `{name}` only (`i18n.tsx:35-40`) and has no plural support, yet callers pass counts: `deposits-view`/`dividends-view`/`expenses-view` build strings like `` `${n} of ${total}` `` and `erp-data-table` uses a hardcoded en-dash. Interpolation with `{count}` is used in `t("deposits.bulk.submit", { count })` — with no plural forms in `messages/*.json`, a locale that requires them (and any grammar-neutral language) will read an English-shaped sentence.
- **English written into tenant data**: `deposit-modal.tsx:117` (`` `${monthKey} deposit` `` saved as `description`), `issue-penalty-modal.tsx` tier titles, `expense-modal.tsx` category fallbacks.
- **RTL is advertised but not implemented** — see UI-017. `lib/i18n.tsx:70` sets `dir="rtl"` for `ur`; `app/globals.css` has no `[dir]` rules and the components use physical utilities.
- **Only 2 of 4 locales offered in Settings** — see UI-045.

## What is done right (short)

- `components/audit/audit-logs-view.tsx` is the reference implementation: 400 ms debounce with timer cleanup, `setPage(1)` on *every* filter change, `rowKey`, `placeholderData` for stable paging, an explicit 403 panel, `emptyMessage={query.isError ? … : …}`, and a matching `t()`-driven vocabulary.
- `components/deposits/deposit-modal.tsx` shows the intended form pattern end-to-end: money as a **string** with a 2 dp regex, `reset()` (not `defaultValues`) in `close()`, `isSubmitting`-disabled submit, month/date mismatch warning, and correct tenant currency/date usage via `shared.ts`.
- `lib/formatters.ts` centralises money/date, guards `null`/`""`/`NaN`, and `components/deposits/shared.ts` sums in **integer cents** (`sumCents`/`centsToAmount`) — the model the float KPI sums in UI-012/UI-038 should copy.
- `components/ui/top-sheet.tsx` portals to `document.body` with `role="dialog"`, `aria-modal`, an Escape handler, `body` scroll-lock, opaque surfaces, and a real `TopSheetProps` contract that accepts both `open` and `isOpen` (so no caller silently no-ops).
- `useLocale().t()` is used consistently in most list views, and `ERPFormField`/`ERPFormGrid`/`ERPConfirmDialog`/`StatusBadge` centralise form + status rendering.
- Zero `console.error`/`alert()` in `app/`+`components/` — every failure is surfaced through `sonner` toasts with unmasked server messages (AGENTS.md §11), and the login page maps 401/403/423/429/5xx to distinct, translated messages.
- `app/globals.css` defines semantic tokens for both themes (`:root` / `.dark`), includes a `prefers-reduced-motion` block, and `suppressHydrationWarning` on `<html>` keeps `next-themes` from warning.
- No emoji anywhere in the UI — icons are lucide SVG only; the only Unicode glyphs found are `⌘K`, `•` and `–` (see UI-026/UI-056).
