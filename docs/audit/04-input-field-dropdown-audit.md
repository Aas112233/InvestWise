# Input Field Audit — API Dropdown Selection Analysis

> Scope: every form, modal, filter and page input in `app/**` and `components/**`.
> Rules applied: AGENTS.md §4 (no raw `<select>` / free-text for dynamic data — use
> searchable `AppDropdown` backed by API), §5 (cascading parent → child selectors),
> §8 (never raw `<input type="date">` — use `ERPDatePicker` / `ERPFiscalMonthPicker`),
> §15 (no pre-selections).

**Result: 1 raw `<select>` remains in the entire app (0 after the concurrent
billing migration), and ONE free-text field references live API data — the
register page's "Member ID". Everything else entity-related already uses
`AppDropdown`. The remaining gaps are date-picker violations and one currency
free-text.**

---

## P1 — Replace with API-backed dropdown (dynamic data, real risk)

| # | Field | Location | Current | Why it must change | Replace with |
|---|-------|----------|---------|--------------------|--------------|
| 1 | **Member ID** (account ↔ member link) | `app/register/page.tsx:222-228` | Free text `<input type="text">` | The operator types a member code by hand during user registration. A typo silently links the account to a wrong or nonexistent member — a data-integrity and audit hazard on an auth-critical flow. | `AppDropdown` fed by `GET /members` (value = member **UUID**, label = `Name (MEM-xxx)`). Send the UUID, not the typed code. Optional: disable/clear when role ≠ Member. |

## P2 — Replace with dropdown (static enum, but must not be free text)

| # | Field | Location | Current | Why | Replace with |
|---|-------|----------|---------|-----|--------------|
| 2 | **Base Currency** | `app/settings/page.tsx:388` | Free text | A typo (`BDT ` vs `BDT`, lowercase, extra space) breaks `formatMoney` and every financial display/PDF in the tenant. Currency is a closed ISO-4217 set. | `AppDropdown` over a fixed ISO currency list (BDT default, USD, EUR, GBP, INR, SAR, AED). Static list, not API — but never free text. |

## P3 — Date/money semantics violations (§8) — replace with the existing ERP pickers

Not API dropdowns, but they fail the same "structured input" principle. `ERPDatePicker`
and `ERPFiscalMonthPicker` already exist and are used elsewhere (e.g. `deposit-modal`,
`bulk-deposit-modal`).

| # | Field(s) | Location | Current | Replace with |
|---|----------|----------|---------|--------------|
| 3 | Project Start / Completion Date | `components/projects/project-form-modal.tsx:219,228` | `<input type="date">` | `ERPDatePicker` |
| 4 | Goal Deadline | `components/goals/goal-form-modal.tsx:169` | `<input type="date">` | `ERPDatePicker` |
| 5 | Expense Date | `components/expenses/expense-modal.tsx:233` | `<input type="date">` | `ERPDatePicker` |
| 6 | Meeting Date & Time | `components/meetings/meeting-form-modal.tsx:115` | `<input type="datetime-local">` | `ERPDatePicker` (datetime variant) |
| 7 | Report Fiscal Month / Fiscal Year | `components/reports/reports-view.tsx:217,242` | `<input type="month">` / `<input type="number">` | `ERPFiscalMonthPicker` (already used in `bulk-deposit-modal`) |
| 8 | Report Custom Start / End Date | `components/reports/reports-view.tsx:255,263` | `<input type="date">` | `ERPDatePicker` |

## P4 — Optional hardening (no rule breach)

| # | Field | Location | Note |
|---|-------|----------|------|
| 9 | Nominee Relation | `components/members/member-form-modal.tsx:230` | Free text is acceptable, but a static dropdown (Spouse / Son / Daughter / Father / Mother / Other) prevents dirty data in reports. |
| 10 | Dropdown feed `limit=100` | `components/expenses/expense-modal.tsx:70,83` (`/funds?limit=100`, `/projects?limit=100`) | The funds Zod cap is **200** — a tenant with 101+ funds silently loses options in this dropdown. Extract a shared `useFundOptions()` / `useProjectOptions()` / `useMemberOptions()` hook with the correct caps (funds 200, members 500) instead of per-modal ad-hoc queries. |

## Compliant — verified, no action needed

**API-backed AppDropdowns already in place:**

| Form / View | Entity fields (API-backed) |
|-------------|---------------------------|
| Deposit Modal (`deposit-modal.tsx`) | Member → `/members`, Fund → `/funds`, Method |
| Deposit Request (`deposit-request-view.tsx`) | Member, Fund, Method |
| Bulk Deposit (`bulk-deposit-modal.tsx`) | Per-row Member (with duplicate-row filtering), Fund, Method |
| Expense Modal (`expense-modal.tsx`) | Category, Fund, Project |
| Issue Penalty (`issue-penalty-modal.tsx`) | Target Member → `/members`, Escalation Tier, Action Type |
| Fund Transfer (`fund-transfer-modal.tsx`) | Source Fund, Destination Fund (§5 pair) |
| Fund Modal (`fund-modal.tsx`) | Type, Status |
| Project Form (`project-form-modal.tsx`) | Category, Linked Fund, Lifecycle Status |
| Goal Form (`goal-form-modal.tsx`) | Goal Type, Linked Project |
| Project Update (`project-update-modal.tsx`) | Update Type |
| Dividend Distribution (`dividend-distribution-modal.tsx`) | Source Fund, Statutory Reserve Fund |
| Meeting Form (`meeting-form-modal.tsx`) | Participant Scope; attendance uses a member **roster** with PRESENT/EXCUSED/ABSENT toggles (no free-text member entry) |
| Reports (`reports-view.tsx`) | Conditional Target Project / Member / Fund (§5-style scope selectors) |
| Analysis (`analysis-view.tsx`) | Member, Period |
| Settings (`settings/page.tsx`) | Fiscal Year Start/End, Accounting Method, Date Format, Locale, Penalty Rule Type |
| Admin Tenants (`admin/tenants/page.tsx`) | Plan, Max Users |
| Admin Billing (`admin/billing/page.tsx`) | Subscription Status, Plan (migrated from the app's last raw `<select>`) |
| Register (`register/page.tsx`) | Role |
| All list views | Text search (legitimate) + status/type `AppDropdown` filters |

**Legitimate free-text inputs (keep as-is):** names, emails, phones, NID,
addresses, nominee fields, amounts (`inputMode="decimal"`), references/trx IDs,
notes/reasons/agenda, org profile fields, policy numbers, search boxes, format
radios, login/register credentials.

---

## Recommended execution order

1. **P1 Register Member ID → member dropdown** (auth-critical, small diff).
2. **P2 Base Currency dropdown** (one-line data-integrity win).
3. **P4 hook extraction** — `useFundOptions`/`useMemberOptions`/`useProjectOptions`
   with correct caps; fixes the silent-truncation class everywhere at once.
4. **P3 date pickers** — mechanical swap of 5 files, biggest diff, zero risk to data.
5. **P4 nominee relation** — optional.
