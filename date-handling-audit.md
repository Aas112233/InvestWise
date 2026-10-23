# Date Handling — Audit & Remediation

Date: 2026-10-23 · Scope: all 95 date/timestamp columns across 25 tables

## Verdict before remediation
Conventions were consistent (ISO wire, tenant date pattern, UTC-inclusive range ends, deterministic sort tiebreakers) but **no tenant timezone existed anywhere**: business days were UTC-anchored calendar days, filters covered UTC days, and month/fiscal attribution used UTC — shifting the boundary by +3…+7h for every current tenant.

## Shipped now (Tier 1 + Tier 3)

| Change | Files |
|---|---|
| `system_settings.timezone` (IANA, default `Asia/Dhaka` = platform default, so no retroactive day shifts) | `db/schema/system_settings.ts`, `server/src/db/schema/system_settings.ts`, `db/migrations/0022_tenant_timezone.sql` |
| Settings API + UI + `useTenantTimezone()` | `app/api/settings/route.ts`, `lib/utils/validation.ts` (IANA refine), `app/settings/page.tsx`, `lib/use-tenant-settings.ts`, messages ×4 |
| Pure helpers: `calendarDayForInstant`, `dayRangeUtc` (tz-aware day window), `dayEndUtc`, `parseBusinessDate` (rejects junk + future beyond 12 h slack) | `lib/tenant-time.ts` + tests |
| DB reader `getTenantTimezone()` | `lib/tenant-time-db.ts` |
| Ledger date filters (`startDate`/`endDate`) now cover the **tenant day**, not the UTC day | `app/api/transactions/route.ts`, `app/api/deposits/route.ts`, `app/api/expenses/route.ts`, `server getTransactions` (also removes the old `setHours(23:59)` = API-server-clock bug) |
| `depositMonth` fallback attribution in tenant tz (SQL `AT TIME ZONE $tz` + `resolveDepositMonthKey`) | `app/api/deposits/route.ts`, `server/src/modules/finance/service.ts` |
| Future-date & junk-date guards on every money write path (deposit collected/submitted, expense create+edit, earning, fund transfer) | `server/src/modules/finance/service.ts` resolvers |
| `EDIT_DEPOSIT`/`EDIT_EXPENSE` audit details now record the posting-date change (value-change trail) | same |
| Transfer modal reuses `todayLocalIso()` — duplicate helper removed | `components/funds/fund-transfer-modal.tsx` |

Penalties `issuedAt` and payout due dates need no guard (server-set now; installment schedules are legitimately future-dated).

## Tier 2 — planned column-type migration (NOT applied; review first)

Industry standard separates **calendar days** (Postgres `date`) from **instants** (`timestamptz`). Apply incrementally, one table at a time, each as its own numbered migration + code pass:

| Table.column | New type | Backfill |
|---|---|---|
| `transactions.date` | `date` | `USING (date AT TIME ZONE 'Asia/Dhaka')::date` |
| `transactions.submitted_date` | `date` | same |
| `meetings.meeting_date` | `date` (keep `started_at`/`completed_at` as timestamptz) | same |
| `member_payout_plans.first_due_date`, `member_payout_installments.due_date` | `date` | same |
| `member_penalties.issued_at` | `date` | same |
| `fiscal_periods.period_start`, `period_end` | `date` | `::date` |

Code impact checklist per column (do all before switching the type):
1. Reads: every `formatDateOnly`/`formatDatePattern` caller keeps working (string still parses), but `AT TIME ZONE` clauses and `dayRangeUtc` bounds become plain `>= start::date AND < end::date + 1`.
2. Writes: resolvers return `Date`; insert into `date` column truncates the time — acceptable.
3. Reports/ledger grouping simplifies (`GROUP BY date` becomes exact).
4. Sort tiebreakers already on `createdAt` (since 0021) — unaffected.
5. Index rebuild: `idx_trans_tenant_date` etc. carry over via `REINDEX` after ALTER.

**Why separate:** the type change is irreversible-ish against live books (drops time-of-day written before migration), so it should run only after confirming the existing rows' UTC-anchored days match what tenants consider their business days.

## Deferred ideas (deliberate product decisions, not fixes)
- Backdating window setting (e.g. block postings into fiscal periods closed > N days ago) — needs a product call on grace policy.
- Rendering `createdAt` in tenant tz instead of viewer-browser tz — do together with Tier 2 so instants and days flip in one coherent pass.
