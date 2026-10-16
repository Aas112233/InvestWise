# InvestWise — Input Size & Format Validation Audit

**Date:** 2026-10-16 · Cross-checks three layers for every user-writable field:
**DB limit** (`db/schema/*.ts`) → **API validation** (zod / inline) → **UI constraint** (`maxLength`).

## Verdict up front

The **money-critical paths are properly validated** (members, projects, deposits, transactions, signup, plans, settings-org). But **five secondary endpoints accept strings with no length ceiling at all** — those fail as Postgres 22001 → HTTP 500 instead of a clean 400 field error, and two of them (penalties, funds) can accept **negative money values**. The UI layer contributes almost nothing: exactly **one** `maxLength` in the entire component tree. Postgres is currently the last (and only, for the gaps) line of defense.

---

## 1. Properly validated (limit matches DB column)

| Endpoint | Field | Limit | DB column |
|---|---|---|---|
| `POST/PUT /api/members` | name | 2–255 | varchar(255) |
| | email | 1–255 + format | varchar(255) |
| | phone | 1–50 | varchar(50) |
| | nidOrPassport / nomineeNidOrPassport | ≤100 | varchar(100) |
| | fatherName / nomineeName | ≤255 | varchar(255) |
| | address | ≤500 | varchar(500) |
| | nomineeRelation | ≤100 | varchar(100) |
| | nomineePhone | ≤50 | varchar(50) |
| | avatar | ≤500 | varchar (unbounded) |
| | shares | int ≥ 1 | integer |
| `POST /api/projects` | title, category | 1–255 | varchar(255) |
| | newFundName, projectFundHandler | ≤255 | varchar(255) |
| | expectedRoi | 0–100 | decimal(5,2) |
| | budget / initialInvestment | ≥ 0 (no max — decimal(15,2) ceiling ≈ 10¹³, theoretical) | decimal(15,2) |
| | shareholders | ≤ 1000 rows | — |
| `POST /api/transactions`, `/api/expenses`, `/api/dividends/*` | amount | `parsePositiveAmount` / `positiveAmount` — positive, ≤ 2dp, **≤ 10,000,000** | decimal(15,2) |
| | referenceNumber (disbursement/distribute-returns) | ≤ 255 | varchar(255) |
| | description | ≤ 500 (stricter than `text` — safe) | text |
| `POST /api/deposits*` (all 3 routes) | depositMonth | `^\d{4}-(0[1-9]\|1[0-2])$` enforced **at the route** (schema is loose on purpose) | varchar(7) |
| | depositMethod | **whitelist**: must be a tenant-configured method (names ≤ 40, ≤ 20 methods, validated in settings) | varchar(50) |
| | handlingOfficer | session user's name, not client input | varchar(255) |
| | amounts | `parsePositiveAmount` + integer-cents re-validation in service | decimal(15,2) |
| finance tree (`/api/finance/deposits*`) | depositMonth | service-level: explicit-but-unparseable → **400, never silently replaced** (`resolveDepositMonthKey`) | varchar(7) |
| `POST /api/auth/signup` | email | 5–254 + format | varchar(255) |
| | password | 8–200 | varchar(255) |
| | organizationName / adminName | 2–120 (stricter than varchar(255) — safe) | — |
| | turnstileToken | ≤ 2000 | — |
| `POST/PUT /api/admin/plans` | slug | 2–100 + `/^[a-z0-9-]+$/` | varchar(100) |
| | name | 1–255 | varchar(255) |
| `POST /api/admin/settings` | platformName | ≤120 | varchar(120) |
| | supportPhone | ≤40 · defaultTimezone ≤60 · maintenanceMessage ≤500 | match DB |
| `POST/PUT /api/auth/users/[id]` | name 2–255 · password ≤200 | match DB |
| `fiscal/periods` | notes ≤ 1000 | varchar(1000) |
| `admin/notices` | title ≤200 · message ≤5000 (stored in jsonb anyway) | — |
| `updateSettingsSchema` (org/financial/governance) | companyName ≤150, tagline/address ≤255, phone/regNo ≤50, website ≤100, baseCurrency ≤10, taxRate 0–100, percents 0–100, day fields 1–28, months 0–60, paymentMethods ≤20×≤40 | match DB |

Also verified **injection-safe**: `sortBy` is whitelist-mapped (`sortFieldMap[x] || date`), all SQL is parameterized via drizzle, search params are bound, pagination is clamped (`limit ≤ 100`), idempotency reference numbers are capped and unique-indexed.

## 2. Gaps — no ceiling, or wrong-kind validation

### High (money semantics or account lockout)

| # | Endpoint | Field | DB | Problem | Failure mode |
|---|---|---|---|---|---|
| H1 | `POST /api/governance/penalties` | `deductionAmount` | decimal(15,2) | **No ≥ 0 / no type check.** Negative = a *credit* to a member's fund; a string → 500 | Silent financial logic error |
| H2 | `POST /api/governance/penalties` | `type` | varchar(50) | No enum — any string becomes a penalty type | Garbage classification |
| H3 | `POST /api/admin/tenants/onboard` | `adminPassword` | varchar(255) | **No max length.** bcrypt truncates at **72 bytes** — a 200-char password is hashed in truncated form, and the user **cannot log in with what they typed** | Account lockout at first login |
| H4 | `POST /api/funds`, `PUT /api/funds/[id]` | `initialBalance`, `minimumBalance` | decimal(15,2) | `z.union([number, string→Number(v)\|\|0])` — **negative values accepted**, `NaN→0` silently | Negative fund floor / balance |

### Medium (500-instead-of-400 on overlong input)

| # | Endpoint | Field(s) | DB limit | Note |
|---|---|---|---|---|
| M1 | `POST /api/funds`, `PUT /api/funds/[id]` | `name` (no `.max`!) | varchar(255) | The exact class you asked about: a 300-char fund name → Postgres 22001 → **500** |
| M2 | same | `handlingOfficer`, `accountNumber` | varchar(255) | no max |
| M3 | `POST /api/meetings` | `title`, `location` | varchar(255) | only `.trim()` |
| M4 | same | `meetingType` | varchar(50) | no max **and no enum** |
| M5 | same | `meetingDate` | timestamptz NOT NULL | `new Date(anything)` — garbage → Invalid Date → 500 |
| M6 | `POST /api/goals` | `title` | varchar(255) | no validation at all (route reads raw body) |
| M7 | same | `targetAmount` | decimal(15,2) NOT NULL | no positive/max check |
| M8 | same | `type`, `status` | varchar(50) | no enum |
| M9 | `POST /api/governance/penalties` | `title` | varchar(255) | user title unbounded (falls back to tier title only if absent) |
| M10 | `POST /api/admin/tenants` | `name` | varchar(255) | slug is properly regex-checked; name is not |
| M11 | `POST /api/admin/tenants/onboard` | `name`, `adminName`, `adminEmail` | varchar(255) | no max; `slug` has no regex here (admin panel path, unlike self-serve signup); `plan` no enum; `maxUsers` no int check |
| M12 | `POST /api/transactions` | `referenceNumber` | varchar(255) (+ unique index) | idempotency key — no max (the disbursement schema has `.max(255)`, this inline route doesn't) |
| M13 | `PUT settings` (financial) | `companyEmail` | varchar(100) | `.email()` but **no `.max(100)`** — a valid 150-char email → 500 |
| M14 | same | `refreshInterval`, `dateFormat` | varchar(50) | `z.string().optional()` — no max |
| M15 | `POST /api/finance/deposits*` (finance tree) | `depositMethod` | varchar(50) | **No whitelist** in the finance tree (the app/api/deposits tree has one) — an 80-char method string → 500 |

### Low (bounded in practice, worth tightening)

- `updateSettingsSchema.financial`: `shareValueBdt`, `maxWithdrawalPerRequest` — positive but unbounded vs decimal(15,2) ceiling (~10¹³). Overflow only at absurd values; still, a `.max()` is one line each.
- `updateSettingsSchema.governance`: `meetingTypes` array unbounded; `penaltyRules[].title` unbounded — both land in jsonb (no column limit), so no 500 risk, just hygiene.
- `transactionQuerySchema.search` — unbounded query string; used in a bound parameter with a trgm index, so no injection/perf disaster, but a `.max(200)` is cheap.

## 3. Systemic findings

1. **UI layer ≈ 0% of the job.** Exactly one `maxLength` exists in `components/` (expense modal, description 255). Every other form lets users type unlimited characters and only finds out on submit — a 400 field error when the server validates, a 500 toast when it doesn't (all M-gaps above). Recommended order of work:
   - **Fix the server gaps first** (that's what protects the data),
   - then add `maxLength` to inputs for the already-validated fields (pure UX: prevents hitting the 400 at all),
   - then add it for the gap fields once the server returns proper 400s.
2. **Two validation styles coexist**: the modern declarative `memberCreateSchema` (per-field limits with friendly messages — the gold standard, per its own docstring the old hand-rolled checks were consolidated into it) and older routes that trim-and-insert with no schema (meetings, goals, penalties, tenants). The modern pattern already exists in-repo; porting is mechanical.
3. **Postgres 22001 is the de-facto length validator** for every gap above. It prevents data corruption (nothing is ever truncated silently — good), but the error surfaces as a 500 and the audit log records a failure for a user-input mistake.
4. **bcrypt 72-byte rule** (H3) is the one gap that can break *functionality* rather than just return an ugly error — worth fixing even if you skip the rest.

## 4. What would NOT be a problem to confirm

- `description`/`agenda`/`notes`/`reason` free-text fields landing in `text` columns — no limit needed.
- jsonb fields (permissions, penaltyRules, paymentMethods) — no column length; arrays/strings are practically bounded by request size and (for paymentMethods) by the settings schema.
- Amounts — every money field routes through `parsePositiveAmount`/`positiveAmount`/cents re-validation; the 10M ceiling keeps values far under the decimal(15,2) max.
- Dates — ISO regex + real-calendar check in the finance tree; the only unvalidated date is meetings' `meetingDate` (M5).

## 5. Suggested fix batches (each ~30–60 min, independently shippable)

1. **Money-semantics**: penalties `deductionAmount` `.min(0)` + `type` enum; funds balances `.min(0)` and drop the `NaN→0` coercion (make it a real error). — *H1/H2/H4*
2. **Onboard**: `adminPassword` `.max(72)` (bcrypt-safe) + name/email `.max(255)` + slug regex reused from the tenants route + `plan` enum + `maxUsers` int. — *H3/M11*
3. **Funds/Meetings/Goals/Penalties/Transactions**: add the missing `.max()`/enum/date checks, porting the `memberCreateSchema` pattern (single schema file per entity, `safeParse` + field-error response). — *M1–M12*
4. **Settings hygiene**: `companyEmail.max(100)`, `refreshInterval/dateFormat.max(50)`, `shareValueBdt/maxWithdrawalPerRequest.max(999_999_999_999.99)`, `search.max(200)`. — *M13/M14/low*
5. **UI**: `maxLength` on every text input/textarea matching its server limit (data available in the table above); `inputMode="numeric"` + `maxLength` where appropriate.
6. **Finance-tree parity**: reuse the tenant payment-method whitelist in `/api/finance/deposits*` (M15).

Tests: each schema addition is trivially covered by an existing-style unit test (the repo already tests money/fiscal/permission logic in `lib/*.test.ts`); a vitest file per new schema fits the current convention.
