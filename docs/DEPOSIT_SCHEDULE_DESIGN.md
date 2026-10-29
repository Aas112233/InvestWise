# Deposit Schedule Architecture — Monthly + Flexible (rev 2)

**Status:** Approved design, supersedes rev 1
**Author:** Accio (tech lead) · **Date:** 29-10-2026
**Rule basis:** `AGENTS.md` §0, §6, §8, §11, §12, §13, §15

> **rev 2 change of ruling.** Rev 1 ruled flexible = obligation-bearing with a period target.
> Owner decision overrides it: **a flexible tenant has no month restriction, no deposit
> performance module, and no obligation. Share models are unchanged.** This document is the
> design for *that* product. Rev 1's obligation columns, `NOT_EVALUATED` compliance state, and
> period-target machinery are **removed** — see §4. Rev 1's Phase 0 lock, one-ledger principle
> and delivery gates survive unchanged.

---

## 1. The correction that governs everything else

**"No month restriction" must mean no month *lock*. It must never mean no month *attribution*.**

These are two different things and collapsing them is the single way this feature destroys data.

| | Monthly | Flexible |
|---|---|---|
| `transactions.deposit_month` populated | yes | **yes — unchanged** |
| One deposit per member-month | enforced | **not enforced** |
| Obligation / compliance / performance | evaluated | **not evaluated** |
| Fiscal-period guard, approval flow, audit, soft delete, idempotency | enforced | **enforced — unchanged** |

If an implementer "removes the month restriction" by letting `deposit_month` go NULL — which is
what the phrase invites — deposits do not merely lose a label. They **silently vanish from
reporting**:

- `app/api/analytics/analysis/route.ts:167-168` filters `gte(depositMonth, slotStart)` /
  `lte(depositMonth, slotEnd)`. SQL range comparison against NULL is NULL, so the row is
  **excluded from the fiscal-year deposit series**. No error, no zero, no warning — the money
  exists in the ledger and is simply absent from the analysis.
- `app/api/analytics/stats/route.ts:206-225` has the same shape, with a regex guard
  (`depositMonth ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`) that also fails on NULL.
- `lib/reports/data.ts:363, 426, 619, 728, 752` render `depositMonth` as a report column → blank.
- `members.lastDepositMonth` recomputes from `MAX(COALESCE(deposit_month, to_char(date…)))` at
  four sites (`[deposits/[id]/revert:217]`, `[transactions/deleted/[id]/restore:121]`,
  `app/api/members/recalculate-financials:72,138`, `finance/service.ts:1003`) — degrades, not breaks.

The first two are the dangerous ones: silent under-reporting of collections in a product that
moves real member money (§0). **A verification test for this is mandatory** (§8 Phase 3).

So: a flexible deposit gets `deposit_month` = the period the money landed in, on the tenant wall
clock (`resolveDepositMonthKey`, [finance/service.ts:153](../server/src/modules/finance/service.ts:153)
already does exactly this when no month is supplied). Officer-overridable. Never NULL on a new
row. Reports and accounting keep working untouched, and the tenant still gets monthly *visibility*
without monthly *obligation*.

That is the whole trick: **strip the constraint, keep the dimension.**

---

## 2. Shares — confirmed, and it retires one of my earlier objections

You said share models don't change. Verified, and the consequence is favourable:

- `addDeposit` on completion credits `funds.balance`, `members.totalContributed`,
  `lastDepositMonth` and **never touches `shares`**
  ([finance/service.ts:629-647](../server/src/modules/finance/service.ts:629)).
- Dividend allocation is flat per share, `totalCents * m.shares / totalShares`
  ([lib/money.ts:113-121](../lib/money.ts:113)).

Therefore **deposit timing and frequency have exactly zero effect on any member's dividend.**
Which means the time-weighted dividend-fairness problem I raised in rev 1 **does not arise in
this design** — it only existed if flexible deposits minted equity. I am withdrawing it, and it
comes off the risk register. Share-value immutability (§12 `isShareValueLocked`) is likewise
untouched. No equity work is in scope. Confirmed clean.

---

## 3. Why this is now *simpler* than rev 1

Exempting a non-monthly member is already the designed behaviour in the compliance engine:
`isMonthlySchedule` ([status-service.ts:294](../lib/governance/status-service.ts:294)) plus the
sweep's `skippedNonMonthly` guard
([status-service.ts:612-616](../lib/governance/status-service.ts:612)), which already counts
skips and returns them in `SweepResult`.

And `isMonthlySchedule(null)` returns **true**, so every existing member row — and every row with
`'monthly'` — stays monthly with no backfill. The vocabulary set is
`MONTHLY_FREQUENCIES = {"monthly","month","1"}`
([status-service.ts:51](../lib/governance/status-service.ts:51)); anything else is flexible.

So no obligation ladder, no `requiredCents = 0` rework (rev 1 Trap 1 — now moot, because flexible
members never reach `evaluatePeriodDeposits` at all), no period-target arithmetic.

The work is not "build a second engine". It is **"switch one flag off consistently in every
place that reads it, and never let a place half-read it."** That is exactly what §4–§6 are for.

---

## 4. Data model — two columns, no backfill, no obligation

On `system_settings` (one row per tenant; already holds `depositDueDate`, `gracePeriodDays`,
`lateDepositGraceMonths`, `inactiveAfterMonths`, `suspendedAfterMonths`, and
`getGovernanceRules` already loads the row — the policy costs no extra query).

```sql
-- 0025_deposit_schedule  (additive, re-runnable, no backfill, no row modified)
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_schedule"          varchar(20) DEFAULT 'monthly';
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_schedule_changed_at" timestamp with time zone;
```

| Column | Default | Purpose |
|---|---|---|
| `deposit_schedule` | `'monthly'` | `'monthly'` \| `'flexible'`. Tenant default. `'monthly'` = today, exactly |
| `deposit_schedule_changed_at` | `NULL` | Set only when the tenant switches to flexible. Drives orphan release (§7 H3) and audit context |

- **`deposit_schedule_target` is deleted from rev 1.** No obligation exists, so there is nothing
  to configure. §13.
- Per-member override: reuse `members.depositFrequency`. No new column. Tenant flag is the
  default; a member-level value outside `MONTHLY_FREQUENCIES` makes that member flexible even in
  a monthly tenant, which is already how the sweep behaves.
- **Apply to both schema copies** — `server/src/db/schema/system_settings.ts` and
  `db/schema/system_settings.ts`. `deposit-month-limit.ts:52-62` documents the dual-Drizzle
  bridge; one copy only = silent drift.
- **`transactions.deposit_month`: no change at all.** Not nullable, no default change, index
  `idx_trans_tenant_deposit_month` stays. It is still written on every flexible deposit (§1).

Migration style: three statements of `IF NOT EXISTS` + `RAISE NOTICE` summary, matching
`0005_deposits_two_dates.sql` / `0024`.

---

## 5. One gate, so no module can half-exempt

The failure mode of "turn governance off" is partiality: the sweep asks, the leaderboard forgets.
So the question is asked in exactly one place.

New pure module `lib/deposit-schedule/schedule.ts`:

```ts
export type DepositSchedule = 'monthly' | 'flexible';

/** Member override wins; unknown/absent values fall back to MONTHLY, never flexible. */
export function resolveDepositSchedule(input: {
  tenantSchedule?: string | null;
  memberDepositFrequency?: string | null;
}): DepositSchedule;

/** THE gate. Every consumer asks this — none re-derives it. */
export function isDepositObligationEnforced(input: {
  tenantSchedule?: string | null;
  memberDepositFrequency?: string | null;
}): boolean;   // false => no month lock, no compliance, no performance score
```

Fail-closed on garbage: an unrecognised `deposit_schedule` string resolves to **monthly**, and
`normalizeGovernanceRules` should reject it so `getGovernanceRules` surfaces `problem` exactly as
it already does for a bad `shareValueBdt`
([status-service.ts:104-110](../lib/governance/status-service.ts:104)). A corrupt row must never
silently drop a tenant's members out of compliance.

### Enforcement change — short-circuit inside the finders, not at the call sites

`lib/deposit-month-limit.ts` documents its 8 write paths at lines 17-21. Add an optional
`enforced` (or `onePerPeriod`) argument to the 3 condition builders and 3 finders. When not
enforced, `findDepositMonthOccupant` returns `null` and `findDepositMonthOccupants` returns `[]`
**before touching the database.**

This is the load-bearing structural decision: if each of the 8 call sites must remember to check
the policy, someone will miss one within six months and the failure is double-counted member
contribution and fund balance — precisely the incident the file was written to prevent
(lines 11-15). Put the branch where the rule lives, once.

| Site | Monthly behaviour | Flexible behaviour |
|---|---|---|
| `app/api/deposits/route.ts:429, 531` | occupied → 409 | guard returns no occupant → posts |
| `app/api/deposits/request/route.ts:149, 187, 229, 232` | occupied → 400 | posts |
| `app/api/deposits/[id]/approve/route.ts:179-183` | occupied → 400 | approves |
| `finance/service.ts` `addDeposit:596`, `editDeposit:901`, `approveDeposit:1093`, `bulkAddDeposits:2592` | 409 | posts |

Predicate text for `enforced !== false` must be **byte-identical** to today, or monthly has
regressed. Verified by Phase 2's equivalence gate.

### Bulk validation gate

`bulkDepositSchema.superRefine` ([validation.ts:90-100](../server/src/modules/finance/validation.ts:90))
currently hard-requires a month per row, with the rationale "*the write path must never guess the
accounting period (§8)*". Keep that for monthly. For flexible, allow omission and derive from the
collected date explicitly — that is not guessing, it is the product rule (§1). Do not weaken the
monthly branch to share one code path.

---

## 6. What turns off, what must never turn off

**Off for a flexible tenant:** one-deposit-per-month lock · governance compliance and auto-hold ·
deposit punctuality scoring · leaderboard inclusion · the regularity/arrears matrix.

**Never off, regardless of schedule** — this is the list an implementer must not "simplify":

| Control | Where |
|---|---|
| Fiscal period open check | `assertFiscalPeriodOpen` ([service.ts:589](../server/src/modules/finance/service.ts:589)) — now the *primary* accounting guard |
| Request → approve workflow | `deposits/request`, `[id]/approve`, `[id]/reject`, `[id]/revert` |
| `referenceNumber` idempotency | `uq_trans_tenant_reference` ([transactions.ts:92](../server/src/db/schema/transactions.ts:92)) |
| Member row `FOR UPDATE` serialisation | [service.ts:592-595](../server/src/modules/finance/service.ts:592) |
| Soft delete + `deletionReason` | §12 |
| Integer-cents money, `amount > 0` | §8, `parsePositiveAmount` |
| Tenant scoping | §6, every query |
| Audit log | `ADD_DEPOSIT` pattern ([service.ts:649](../server/src/modules/finance/service.ts:649)) |
| Suspended-member deposit block | `assertMemberNotSuspended` ([service.ts:571](../server/src/modules/finance/service.ts:571)) |

With the month lock gone, **the fiscal-period guard and the approval workflow are the only
remaining accounting controls.** They must be treated as load-bearing, not optional.

---

## 7. Verified consequences — "what could affect" (the real answer)

Each item was confirmed in current source, not hypothesised. H1, H2, H3, H4 and H7 are
high severity.

**H1 — Performance scoring has no schedule guard, and will actively defame flexible members.**
`calculateMemberPerformance` ([performance.ts:69-158](../lib/governance/performance.ts:69)) reads
`shares` and `monthlyDepositTarget` — **not `depositFrequency`** — and grades punctuality as 60 %
of the score. For a member with no obligation, `requiredMonthlyCents` still floors at
`Math.max(1, shares)` ([status-rules.ts:497](../lib/governance/status-rules.ts:497)), so no month
ever satisfies `totalCents >= requiredMonthlyCents`; every month becomes `lateMonths` or
`missedMonths`, `depositScore = 0` (line 158), and
`rawScore = 0.6 × 0 + 0.4 × attendance` ([line 240](../lib/governance/performance.ts:240)) caps
at 40 → grade **D/F**.
`recalculateAllMembersPerformance` writes it for **every active member**
([performance.ts:296-309](../lib/governance/performance.ts:296)) — its docstring says "every
*monthly* member" but no such filter exists. A latent bug today; the flexible model makes it live
on a real member's record.
→ Guard both functions on `isDepositObligationEnforced`, and correct the docstring to match.

**H2 — The leaderboard ranks them wrong in *both* directions.**
`ORDER BY desc(members.performanceScore)`
([leaderboard/route.ts:52](../app/api/governance/leaderboard/route.ts:52)) — Postgres puts NULLs
**first** under `DESC`, and line 55 renders `Number(r.performanceScore ?? 100)`. So leaving a
flexible member's stale score ranks them last (H1); NULLing it ranks them **first at 100 % / A+**.
Neither is acceptable. → Flexible members must be **filtered out of the roster query**, not
score-padded. Add `desc(...NULLS LAST)` explicitly, and display "—" where
`member-detail-sheet.tsx:192` already handles null. Note `performanceScore` defaults to `'100.00'`
([members.ts:37](../server/src/db/schema/members.ts:37)), so a newly created flexible member is
already sitting at rank 1 with an unearned A+ today.

**H3 — Switching a live tenant to flexible permanently orphans its auto-held members.**
The sweep `continue`s past non-monthly members
([status-service.ts:612-616](../lib/governance/status-service.ts:612)) **before** evaluating a
restore. A member previously moved to `INACTIVE` with
`statusReason = DEPOSIT_NON_COMPLIANCE` (stamped at [status-service.ts:654-655](../lib/governance/status-service.ts:654))
will never be auto-restored again — silent, indefinite lockout of paying members caused by an
admin settings edit. → The switch transaction must **enumerate** members held with that reason,
show the count in the confirmation step, and release them explicitly with an audit entry. The
sweep must not be relied on to undo it.

**H4 — Bulk import will silently drop legitimate repeat deposits.**
Bulk dedupe matches `existing.depositMonth === monthKey && …`
([service.ts:2496](../server/src/modules/finance/service.ts:2496)). Unlimited deposits make two
identical same-month payments normal (`2 × 500.00`), and the second is skipped as a "duplicate" —
no error, sheet reports success, money never posts. Worst failure in the feature because it is
silent. → Flexible idempotency identity must include `referenceNumber`/`requestKey`. Monthly keeps
its current key untouched.

**H5 — A test asserts the month restriction exists.**
`__tests__/fiscal-period-pickers.test.ts:96` asserts the picker source contains
`disabled: option.value !== depositMonth`, and `deposit-modal.tsx:240` implements it;
`deposit-request-view.tsx:119` blocks on `occupiedMonths.has(depositMonth)`. Removing the block
turns that suite red. → Update the assertion deliberately as part of Phase 4 and state why. Do not
let an implementer "fix" the red test by restoring the block.

**H6 — Two UI month grids become wrong, not merely unnecessary.** ✅ FIXED (session 9)
`findDepositMonthOccupancyInRange` exists so a greyed-out month is exactly a month the POST would
reject ([deposit-month-limit.ts:182-203](../lib/deposit-month-limit.ts:182)). Under flexible
nothing may be greyed out. → The occupancy read is untouched (it correctly returns an empty map)
and a **separate** aggregate, `findDepositPeriodProgressInRange`, answers `count + total per
period` for the flexible grid. It is not built on the occupancy predicate: a one-row-per-month map
reports 1 deposit for a period holding five, which is this harm in the opposite direction. See
"#### The read" under session 9 below.

**H7 — Silent under-reporting if `deposit_month` is ever left NULL.** See §1. The fix is
architectural, not a test: never write NULL.

**H8 — The month lock was accidentally the typo ceiling.** Unlimited, uncapped deposits mean one
fat-fingered `10,000,000` posts straight into `funds.balance` and `totalContributed`
([service.ts:630-646](../server/src/modules/finance/service.ts:630)). §0 says push back here —
not by reinstating a restriction, but by replacing the accidental control with a deliberate one
(§8 R1/R2).

**H9 — Reporting surfaces will read "healthy" when they are actually unmeasured.**
Arrears / compliance-rate / on-time KPIs, the regularity matrix
(`analysis-view.tsx:692-801`, renders "Paid On-Time" / "Missed / Arrears" cells), the governance
view, and `members.totalArrears` (selected in `modules/members/service.ts:40`, never written —
already stale, and it will read a clean `0.00` for flexible tenants). A zero and a
not-measured must not look the same. §0.

**H10 — Minor.** `deposit-excel.ts` template, `deposit-receipt.tsx:71`, `ledger-voucher.tsx:168`
("Deposit for <month>") all stay correct **provided §1 holds** — keep them, they are useful audit
trails for unlimited deposits. `warningCount`/`performanceScore` are `REVIEW_FIELDS` in
`member-privacy.ts:80` — confirm the new null-score path still passes the privacy guard.

---

## 8. Replacement controls (required, not optional)

Unlimited deposits remove the last structural barrier against duplicate money. §0 requires an
industry-standard substitute rather than raw trust. Both are additive; neither restricts a
legitimate payment.

**R1 — Near-duplicate advisory.** Same member + same amount + collected date within N days
(default 3, tenant-settable, `0` disables) → non-blocking warning on the form and in the bulk
result, listing the matching `referenceNumber` and date; audit-logged as
`DEPOSIT_NEAR_DUPLICATE_WARN`. Never a 409 — that would rebuild the restriction the owner
removed. `findDepositMonthOccupant` already returns exactly the fields needed
(`OCCUPANT_FIELDS`, lines 64-70).

**R2 — Amount threshold routes to approval, not direct posting.** Above a tenant-settable
`flexDepositApprovalAbove`, `POST /api/deposits` inserts `status = 'Pending'` instead of
`'Completed'`, reusing the existing request/approve/reject machinery. A second officer then
confirms. Blast radius of a typo becomes "a pending slip", not "posted, then a revert dance with
fund and member debit" (the revert path at `deposits/[id]/revert` is real work and touches
`last_deposit_month` recomputation).

`ponytail:` deliberate v1 ceiling — hard per-period caps are not built. Upgrade path: one column
plus one aggregate check inside the existing `FOR UPDATE` window, which is already safe
(§6) and needs no new locking.

---

## 9. Delivery — same gates, three phases smaller

### Phase 0 — Characterisation lock (mandatory, before any logic change)
`lib/governance/status-rules.characterisation.test.ts` and
`__tests__/deposit-month-limit.characterisation.test.ts`, **literal expected values**, not
as-is snapshots: on-time / late-in-grace / late-beyond-grace / partial / missed, multi-leg cent
splits, forward cascade, `unallocatedCents`, day-clamping (`clampDayOfMonth`, Feb-29), 60-month
window edge, and the full occupancy state matrix (settled / pending-request / reverted-direct /
rejected / soft-deleted / `excludeId`).
**Gate 0:** green on unmodified code. This is what makes "monthly 100 % accurate" checkable.

### Phase 1 — Schema + resolver, provably a no-op
`0025`, both schema copies, `schedule.ts`, `normalizeGovernanceRules` rejection, settings PUT
fields (Zod, §11 error shape).
**Gate 1:** Gate 0 green *unchanged*; everything resolves `enforced: true`; live tenants
indistinguishable.

### Phase 2 — Enforcement threading + the equivalence gate
Policy into `deposit-month-limit.ts` and all 8 write paths; conditional bulk month.
**Gate 2 (critical):** new **equivalence test** — same ledger, monthly, assert governance and
rejection outputs are byte-identical to the Phase 0 fixtures, and assert the generated SQL
predicate string is unchanged for monthly. Gate 2 red ⇒ Phase 3 does not exist.

### Phase 3 — Governance / performance / leaderboard exemption + orphan release
Guard `calculateMemberPerformance` + `recalculateAllMemberPerformance` +
`recalculateAllMembersPerformance` (H1); filter the leaderboard roster (H2); switch-transaction
held-member enumeration and release (H3); bulk dedupe key (H4); **and the H7 regression test** —
a flexible deposit with no explicit month must appear in `analytics/analysis`, `analytics/stats`
and the deposits report for its fiscal period.

### Phase 4 — UI, bulk, reporting honesty, i18n
Picker unblocking (H5 — update `fiscal-period-pickers.test.ts` in the same commit, with a note),
period-progress grid (H6), `NOT_APPLICABLE` states for matrix/KPIs/arrears (H9), R1 warning, R2
threshold settings, 4 locales (`en/ur/hi/bn`), §15 no pre-selection, §11 unmasked toasts.
**Gate 4:** `npm run i18n:validate` + full Pre-Flight list.

### Phase 5 — Proof
Dual-run reconciliation from a pre-switch ledger copy (no monthly drift) · concurrency: parallel
same-member deposits under flexible never double-credit, and monthly never loses its 409 ·
bulk retry-safety plus H4's two-identical-payments case posts **both** · cross-tenant: A cannot
read or flip B's schedule · suspended-member block still fires under flexible (H6 of §6 list).

**Merge order:** 0 → 1 → 2 land before flexible is reachable by any tenant. Nothing ships to a
tenant until its gate is green.

Existing suites that must stay green: `__tests__/deposit-month-limit.test.ts`,
`__tests__/bulk-single-member-months.test.ts`, `__tests__/fiscal-period-pickers.test.ts`,
`lib/governance/status-rules.test.ts`, `lib/governance/performance.test.ts` (if present),
`server/src/__tests__/governance.test.ts`,
`server/src/__tests__/bulk-deposit-idempotency.test.ts`, `lib/deposit-excel.test.ts`,
`lib/deposit-edit-delta.test.ts`.

---

## 10. Out of scope

1. Any equity/share change — none is needed (§2, and you ruled it).
2. Time-weighted dividends. Withdrawn as inapplicable while deposits don't mint shares.
3. Quarterly/annual obligation windows. There is no obligation to window.
4. `member_arrears` revival — dead in both schema copies; only reference is the tenant-purge
   `DELETE` ([superadmin-service.ts:361](../lib/superadmin-service.ts:361)). Do not start writing
   to it as a side effect.
5. Self-service member-facing deposit portal (separate product surface; `request` route already
   supports the flow).

---

## 11. Rollback

`deposit_schedule = 'monthly'` is a settings write; the default already is `'monthly'` and the
monthly branch is untouched code, so rollback needs no migration revert. The two `0025` columns
are additive and unread when monthly. **No existing row is modified by the migration** — that is
why monthly cannot regress at the data layer. Caveat: releases performed by H3's orphan cleanup
are *not* auto-reverted; a member restored on the switch stays active (correct, and reversible
manually).

---

## 12. Decisions I need from you

1. **R1 duplicate window** — 3 days default OK? And warning-only, never blocking?
2. **R2 approval threshold** — should flexible tenants get a mandatory approve-above amount, or
   start with it disabled and let each tenant set it? I recommend mandatory with a high default;
   removing both structural controls at once is how a real co-op gets a wrong seven-figure
   deposit.
3. **H3 held members on switch** — auto-release with an audit entry, or show the list and require
   the admin to confirm each? I recommend confirm-each: it is a status change on real members.

---

## 13. Implementation status (29-10-2026, session 1)

**Verified state: `npm run typecheck` 0 errors · `eslint` 0 issues on all 9 changed files ·
`vitest run` 53 files / 616 tests green (baseline was 50 / 538).**

Everything landed so far is **additive and inert**. No tenant can be flexible yet, no deposit
behaviour changes, and the monthly path is proven unchanged by golden tests. This is a safe merge
point. Nothing is half-wired.

### Landed — Phase 0 (characterisation lock) ✅
| File | What |
|---|---|
| `lib/governance/status-rules.characterisation.test.ts` | 30 golden tests, hand-computed literals |
| `__tests__/deposit-month-limit.characterisation.test.ts` | Monthly predicate locked as **rendered SQL** |

Phase 0 earned its keep — it found four things before any feature code existed:
1. **My spec was wrong** about `graceMonths = 1`: a September leg legitimately settles August.
   Corrected, and the test now pins the reach-back boundary properly (July unreachable).
2. **`GovernanceRuleError` carries its code on `.code`, never in `.message`** — so
   `toThrow('INVALID_PERIOD_KEY')` can never match. Three assertions rewritten to assert the
   real contract, which is what API consumers key on.
3. **The duplicate rule's status vocabulary is inline SQL text, not bind parameters**
   (`IN ('Completed','Success')`, `'pending'`, `<> 'Deposit'`). It is therefore unprotectable by
   parameter assertions — the exact-text lock in this file is the only thing that catches a
   silent edit to it.
4. Two latent quirks pinned as `CURRENT BEHAVIOUR, NOT ENDORSED`: `requiredCents = 0` + a payment
   grades `LATE` (H1/Trap 1 confirmed in the ladder), and the write-path month key is `UTC` while
   `GET /api/deposits?depositMonth=` filters on the **tenant timezone**
   (`app/api/deposits/route.ts:134`) — a deposit recorded near a month boundary can read as one
   month and reserve another. Both recorded, neither changed: fixing them would move existing
   tenants' historical attribution, which is a separate owner decision.

### Landed — Phase 1 (schema + canonical policy) ✅
| File | What |
|---|---|
| `db/migrations/0025_deposit_schedule.sql` | 2 additive columns, `IF NOT EXISTS`, no row touched, `RAISE NOTICE` |
| `server/src/db/schema/system_settings.ts`, `db/schema/system_settings.ts` | Both copies updated |
| `lib/deposit-schedule/schedule.ts` | NEW pure policy module — `resolveDepositSchedule`, `isDepositObligationEnforced`, fail-closed to monthly |
| `lib/deposit-schedule/schedule.test.ts` | 48 tests incl. a **byte-equivalence proof** vs the old rule |
| `lib/governance/status-service.ts` | Local `MONTHLY_FREQUENCIES` deleted; `isMonthlySchedule` delegates to the pure module |

**Deviation from spec §5 (improvement).** I did not thread `deposit_schedule` through
`normalizeGovernanceRules` — it is not a governance rule, and forcing it in would require changing
`GovernanceRules` and every consumer of a 5-field numeric struct. Validation + fail-closed live in
`schedule.ts` instead, which is where the answer is actually consumed.

**Bug caught in my own spec during implementation.** Spec §5 rule 1 said "member override wins".
Every legacy `members` row carries `deposit_frequency = 'monthly'` (column default, hardcoded in
all four seed scripts), so member-precedence would have meant **switching a tenant to flexible
changes nothing** — the feature would appear silently broken. Correct precedence is now: flexible
if the tenant is flexible **OR** the member's frequency names a non-monthly cadence. Pinned by
`CRITICAL: a flexible tenant wins over the member rows that all still say "monthly"`.

Also preserved deliberately: `isMonthlyDepositFrequency` keeps the original falsy-branch semantics
exactly (empty string → monthly, whitespace-only → NOT monthly), because any drift there would
break Phase 1's no-op guarantee.

### Landed — Phase 2 infrastructure (not yet enabled) ✅
| File | What |
|---|---|
| `lib/deposit-month-limit.ts` | `DepositMonthScheduleInput { enforced?: boolean }` on 3 condition builders + 3 finders. `enforced !== false` → **byte-identical** monthly SQL (golden-verified). `false` → always-false predicate / short-circuit before the DB round trip |
| `lib/deposit-schedule/lookup.ts` | NEW `loadTenantDepositSchedule` / `loadMemberDepositSchedule` / `loadMemberDepositSchedules` (batch), dual-Drizzle bridge, reads inside the caller's tx |

The branch is **inside** the guard, as designed, so the 8 call sites cannot forget it.

### NOT done — and why that is the correct state
1. **Phase 2 call-site wiring (8 paths).** No caller passes `enforced` yet. Wiring must be done
   as ONE atomic change across all 8: a subset would let some paths accept second deposits for a
   flexible member while others still `409`, which is a worse inconsistency than either extreme.
2. **Phase 3 exemptions (H1 scoring, H2 leaderboard, H3 orphaned holds, R1, R2).** Blocking
   priority — **no tenant may be switched to flexible until these land**, or a perfectly-paying
   flexible member is written a grade D/F and ranked last, and any member already held for
   non-compliance is locked out permanently.
3. **Phase 4 UI / i18n / reporting `NOT_APPLICABLE` states.** Also currently why flexible is
   unreachable: the settings PUT does not yet accept `depositSchedule`, so it cannot be enabled
   even accidentally.
4. **Equivalence gate (Phase 2 exit).** The monthly golden SQL is already locked, so this is now
   a small mechanical addition.

### How to resume (exact next action)
Wire the 8 sites, one file at a time, passing `enforced` from the schedule already in hand — in
`app/api/deposits/route.ts` the `Promise.all` **already fetches the full `members` row and the
`systemSettings` row**, so adding `depositSchedule` to that existing select resolves the schedule
with **zero extra queries**; the fast-path `findDepositMonthOccupant` then moves just after the
`Promise.all` (it is documented as fast-path only — the authoritative check is the in-tx one
under the member `FOR UPDATE` lock). Then add the equivalence test and run Phase 3 before any
tenant is switched.

### Phase 2 COMPLETE — all 8 write paths wired (29-10-2026, session 2)

**Verified: `tsc` 0 errors · `eslint` 0 issues on all 12 changed files · `vitest` 53 files /
619 tests green. The Phase 0 monthly golden SQL did not change across the entire wiring.**

The equivalence gate now lives in `__tests__/deposit-month-limit.characterisation.test.ts`
(§"Phase 2 equivalence gate") and proves three things, not one:

1. Omitting `enforced`, defaulting it, and passing `enforced: true` all render **byte-identical**
   SQL to the pre-flexible statement.
2. `enforced: false` renders a constant-false predicate with **zero bind parameters** — no
   `tenant_id`, `member_id`, `deposit_month` or `status` reference — so it cannot match a row.
3. The finders short-circuit **without touching the database**, asserted with a `Proxy` stub
   that throws on any property access. This also proves the short-circuit did not swallow the
   monthly rule: the same stub still *is* queried when `enforced` is omitted.

| Path | How the schedule was resolved |
|---|---|
| `POST /api/deposits` | `depositSchedule` added to the `systemSettings` select already in the `Promise.all`, member from the full row already fetched — **0 extra queries** |
| `POST /deposits/request` | same technique — 0 extra queries |
| `POST /deposits/request/bulk` | per-member `depositFrequency` added to the existing batch member select; 0 extra queries |
| `POST /deposits/[id]/approve` | `loadMemberDepositSchedule(tx, …)` — resolved **inside** the tx on the locked member row |
| `finance.addDeposit` / `editDeposit` / `approveDeposit` | `loadMemberDepositSchedule(tx, …)` inside the tx |
| `finance.bulkAddDeposits` | `loadMemberDepositSchedules(tx, …)` — one batched read for the whole sheet |
| `finance.depositMonthStatus` (month grid) | pure resolver over two rows already read |

**Three judgement calls made while implementing, each deliberate:**

1. **Mixed-roster partitioning.** A batch can contain monthly *and* flexible members (tenant
   default plus a member-level cadence), so bulk enforcement partitions per member via an
   `enforcedSet` rather than applying one answer to the batch. Neither group can inherit the
   other's rule.
2. **Approve resolves inside the transaction.** Approval is what credits settled money, so it
   reads the schedule on the `FOR UPDATE`-locked member row. A tenant that flips schedule while a
   request sits in the queue is judged at approval time, not by a stale outer read.
3. **Bulk's `seenEntries` within-batch guard is now schedule-aware.** It previously rejected two
   rows for the same member+month unconditionally — which would have blocked a legitimate
   flexible upload long before it ever reached the occupancy check.

### Correction to this document: H4 was wrong

H4 claimed bulk import would *silently skip* a second identical same-month deposit because its
dedupe matches on `depositMonth` (`finance/service.ts:2496`). **It does not.** Verified while
wiring the path:

- Bulk idempotency is keyed on `bulkDepositReference(batchId, index)` — a per-row reference, not
  the month. A replay either matches every row or throws `IDEMPOTENCY_KEY_REUSED` (409). It never
  silently drops.
- The `existing.depositMonth === monthKey` comparison at that line is part of the *replay
  verification*, not a skip condition.
- Within-batch duplicates were already guarded by `seenEntries` (line 2443) — I briefly suspected
  that set did not exist, because the comment at 2591 references it outside its scope, and
  grepped before "fixing" it. It exists and works.

No silent-drop defect existed. H4 is **withdrawn**. The real bulk change needed was narrower and
is now done: making `seenEntries` permissive for flexible members. Everything else in §7 stands —
H1, H2, H3, H5–H9 were each re-confirmed against source.

### Still before any tenant may be switched to flexible

Phase 3 (H1 performance scoring, H2 leaderboard, H3 orphaned auto-held members, R1/R2) and
Phase 4 (settings UI + 4-locale i18n) remain. Until Phase 3 lands, switching a tenant would write
grade D/F onto perfectly-paying flexible members and permanently lock out anyone previously held
for non-compliance. **Flexible is still unreachable in practice**: the settings PUT does not yet
accept `depositSchedule`, so no tenant can be flipped even accidentally.
### Phase 3 PARTIAL — H1, H2, H3 landed (29-10-2026, session 3)

**Verified: `tsc` 0 errors · `eslint` 0 issues · `vitest` 54 files / 633 tests green.**

| Finding | Fix | File |
|---|---|---|
| **H1** flexible member graded D/F | Punctuality measured only when `depositEnforced`; **weights renormalise** so attendance becomes 100% instead of the member being capped at 40. Deposit rows are not even queried for them. `depositRating: 'MONTHLY_PUNCTUALITY' \| 'NOT_APPLICABLE'` added, `depositMetrics.score/weight` became nullable | `lib/governance/performance.ts` |
| **H2** unscored member ranked **#1 at 100/A+** | `DESC NULLS LAST`; `?? 100` substitution removed; `performanceScore: number \| null` + `unrated` through the API, types and view (em dash, not `null%`) | `app/api/governance/leaderboard/route.ts`, `types/index.ts`, `components/governance/governance-view.tsx` |
| **H3** switch permanently locked out auto-held members | PUT accepts `governance.depositSchedule`; before switching it lists members held with the sweep's own reason and returns **409 `DEPOSIT_SCHEDULE_SWITCH_CONFIRMATION_REQUIRED`** unless `confirmDepositScheduleSwitch` is set; releases them only **after** the settings row commits, touching only sweep-created holds; stamps `depositScheduleChangedAt`; GET returns `depositSchedule \|\| 'monthly'` | `app/api/settings/route.ts`, `lib/utils/validation.ts` |

**Design decision that changed from spec §7/H2.** The spec said filter flexible members out of
the leaderboard. Implementing H1 made that wrong: with weights renormalised a flexible member has
a *real* attendance-and-penalty score, and excluding them would empty the board entirely for a
fully flexible tenant (which is the normal case, since the flag is tenant-level). So they stay
ranked; what got fixed is the fabricated score and the NULL ordering. The mixed-scheme comparison
is an accepted limitation, made visible by `depositRating` rather than hidden.

**Also fixed on the way:** `recalculateAllMembersPerformance`'s docstring claimed it scored
"every monthly member" with no such filter; corrected to say it scores every active member *and
why it must continue to* — skipping flexible members there would freeze their score at its
pre-switch value.

Regression lock: `__tests__/deposit-schedule-exemptions.test.ts` (14 tests) asserts each
exemption in source, matching the convention in `__tests__/deposit-month-limit.test.ts`. It is
source-text assertion because the behavioural equivalents need a live database; it caught its own
over-broad assertion during authoring (`?? 100` also appears in an explanatory comment) and now
targets the exact former expression.

### Remaining before flexible is safe to enable
1. **H7** regression test — a flexible deposit recorded with no explicit month must still appear
   in `analytics/analysis`, `analytics/stats` and the deposits report for its fiscal period. This
   guards §1's rule that `deposit_month` is never written NULL.
2. **R1** near-duplicate advisory · **R2** approve-above-threshold. These are the deliberate
   replacements for the safety the month lock provided by accident (H8).
3. **Phase 4** settings UI section + 4-locale i18n + reporting `NOT_APPLICABLE` states (H9) +
   bulk period-progress grid (H6).

**Current exposure:** the schedule can now be set via `PUT /api/settings`, so it is no longer
unreachable — but H7 and H9 are unverified and the settings **screen** does not exist, so it
should be treated as API-only until Phase 4 lands. Migration `0025` is still unexecuted.

### Process note for review
Five times across these sessions I ended a long `edit` payload with a truncated stub instead of
the intended code. Each was caught by my own typecheck/gate step and none reached a green commit;
`json_placeholder2` was a pointless rename rather than a fix. Worth knowing when reviewing the
diff: the failure mode to look for is stubs, and the reason none survive is the gate ordering.

### Phase 3 continued — H7 landed, plus a real defect found (29-10-2026, session 4)

**Verified: `tsc` 0 errors · `eslint` 0 issues · `vitest` 55 files / 640 tests green.**

`__tests__/deposit-month-attribution.test.ts` (7 tests) locks the §1 invariant that "no month
restriction" never becomes "no month attribution":

- `resolveDepositMonthKey` (now exported for this purpose) returns a valid `YYYY-MM` for **every**
  combination of absent input (`null`/`undefined`/`''`) × boundary dates (Jan-01, Dec-31 23:59,
  Feb-29-leap, Oct-31 23:30) × timezone (Dhaka, Riyadh, UTC) — 36 assertions that it can never
  produce the empty/NULL value that range filters silently drop.
- An explicit officer-chosen month beats the collected date (November money booked to October).
- A malformed explicit month is **rejected**, never substituted (§8: never guess the period).
- Boundary proof: `2026-10-31T23:30Z` attributes to **2026-11** for Dhaka and **2026-10** for UTC.
  Attribution follows the tenant wall clock.

### Defect fixed while doing H7: a NULL door in the bulk insert

`bulkAddDeposits` wrote `depositMonth: monthKey || null`. It cannot produce NULL today —
`resolveBatchRowMonth` throws when a row has no month and no `commonMonth`, and
`resolveDepositMonthKey` always returns `YYYY-MM` — so this was **latent, not live**. But the
coercion documented "NULL is an acceptable period" in the one place a future flexible-batch change
would be tempted to relax the mandatory-month rule, and if it ever fired the money would vanish
from the fiscal-year report silently. Now `depositMonth: monthKey`, with the reason recorded inline,
and the test asserts the old form cannot come back.

This is the §1 principle enforced at the write path rather than left to reviewer diligence.

### Remaining
**R1** near-duplicate advisory · **R2** approve-above-threshold · **Phase 4** (settings UI section,
4-locale i18n, H9 reporting `NOT_APPLICABLE` states, H6 bulk period-progress grid). Migration
`0025` is still unexecuted. R2 in particular changes what status a deposit posts as, so it should
land as its own gated change with money-invariant tests rather than being folded in at the end of a
long session.
### R1 landed (29-10-2026, session 5)

**Verified: `tsc` 0 errors · `eslint` 0 issues · `vitest` 56 files / 651 tests green.**

The month lock used to cap data-entry error by accident. R1 replaces that accident with a
deliberate control that warns without restricting.

| Piece | Where |
|---|---|
| `deposit_near_duplicate_window_days` (int, default 3, `0` disables) | added to migration `0025` (unexecuted, so the file was extended rather than stacking a second migration) + both schema copies |
| `lib/deposit-duplicate-advisory.ts` | window bounds, indexed same-member/same-amount lookup, message formatter |
| `POST /api/deposits` | advisory **after** commit — never reverses a posted deposit; returns `data.advisory` and writes a `NEAR_DUPLICATE_DEPOSIT` audit entry with matched ids |
| `GET/PUT /api/settings` + Zod | `0..30` days, `?? 3` on read so an unprovisioned row matches the write-side default |
| `lib/deposit-duplicate-advisory.test.ts` | 11 tests |

Design constraints enforced by tests rather than by intent:
- **Absent/unset/corrupt window ⇒ disabled, never "warn on everything".** A missing column value
  must not fire a warning on every deposit — that trains officers to ignore all of them.
- **Advisory, never a gate.** It does not use the `[Field …, Code: …]` §11 error shape, which the
  client renders as a rejection; the message says "Recorded anyway".
- **Read-only.** No balance, contribution, ledger or status path is touched.
- **Short-circuits prove no query** on disabled/junk input via a throwing `Proxy` stub, so the
  advisory can never slow or fail a legitimate write.
- Window is **symmetric** (±N days): a typo repeat is as likely to sit a day earlier as a day later,
  and an asymmetric window would miss half of them.

`noUncheckedIndexedAccess` caught `matches[0]` in production code during this step; fixed with
`.at(0)` plus an explicit guard.

### Remaining to reach "safe to enable"
**R2** (approve-above-threshold) — still deliberately deferred: it changes whether a deposit posts
as settled `Completed` moving money or as `Pending` in a queue. That is money-posting semantics and
needs its own gated change with balance-invariant tests. **Phase 4** UI/i18n/H9/H6. Migration
`0025` still unexecuted.
### R2 landed — Phase 3 complete (29-10-2026, session 6)

**Verified: `tsc` 0 errors · `eslint` 0 issues · `vitest` 57 files / 666 tests green.**

`deposit_flex_approval_above` (decimal, NULL = disabled, added to the still-unexecuted `0025`).
When a **flexible** deposit exceeds it, the deposit is filed as a pending request instead of being
posted as settled money.

| Piece | Where |
|---|---|
| Pure decision `resolveFlexApprovalDecision` | `lib/deposit-schedule/approval-threshold.ts` |
| 15 tests incl. an input grid + handler wiring guards | `lib/deposit-schedule/approval-threshold.test.ts` |
| Rerouted insert | `POST /api/deposits` |
| Settings read/write + Zod (`nullable`, so `null` genuinely disables) | `app/api/settings/route.ts`, `lib/utils/validation.ts` |

**Why the decision is a separate pure module:** it chooses whether money posts as settled or waits
for a second officer. That belongs somewhere testable exhaustively, not inside a request handler.

Money-invariant choices, each asserted in tests:
- **No balance, contribution, `lastDepositMonth` or `lastActive` is written on the pending path** —
  both `UPDATE`s sit inside `if (!postsAsPending)`.
- The response cannot claim a balance the ledger never received: `newFundBalanceCents` stays at the
  pre-deposit value when rerouted.
- The row is written in the **exact shape the request form produces** (`Deposit Request` + `PENDING`),
  so approve / reject / revert need no special casing anywhere downstream.
- **Audit action follows reality**: `REQUEST_DEPOSIT`, not `RECORD_DEPOSIT`, plus the threshold that
  triggered it. Logging a rerouted deposit as recorded would leave the trail asserting a posting
  that never happened.
- The success message says no balance was updated, because the client opens the printable receipt on
  success and must be able to tell the two apart.
- **Monthly can never be rerouted.** `enforced` short-circuits inside the decision, so a stale
  threshold left in settings cannot change how a monthly deposit posts.
- Corrupt configured value ⇒ control **disabled**, not deposits blocked. R2 supplements the fiscal
  guard and approval flow; it is not the only control, and bad config must not strand member money.

Errors caught during this step (all mine, all caught before green): a shorthand for a
non-existent variable (`postedAsPending` vs `postsAsPending`), an inverted test ternary that
asserted the opposite of its own name, a bad expected value (`500_01` = 50001, above the
threshold it claimed to sit below), and the recurring truncated-stub slip — sixth occurrence.

### Remaining for the new deposit model
**Phase 4 only**: settings UI section (schedule + duplicate window + approval threshold + the 409
held-member confirmation), 4-locale i18n, H9 `NOT_APPLICABLE` reporting states, H6 bulk progress grid.
**Phase 5**: dual-run reconciliation, concurrency and cross-tenant proof — needs a live database.
Migration `0025` remains unexecuted. R2 currently covers the single direct-deposit path; the bulk
import path can still post a large flexible amount directly and is the one known gap in the
control, deliberately left rather than half-implemented inside a mixed-status batch.
### CRITICAL defect found and fixed + bulk R2 (29-10-2026, session 7)

**Verified: `tsc` 0 errors · `eslint` 0 issues · `vitest` 57 files / 669 tests green.**

#### The defect: the tenant switch reached the write paths but not governance

Introduced by this work, not pre-existing. After wiring `deposit_schedule` through the deposit
write paths, `system_settings` said "flexible" while two consumers kept asking a different
question:

| Consumer | What it read | Consequence of a tenant switch |
|---|---|---|
| `sweepMemberStatuses` (`status-service.ts:614`) | `members.deposit_frequency` **only** | members keep being **auto-held** for monthly deposits the schedule no longer requires |
| Analysis payment matrix (`analysis/route.ts:419`) | `members.deposit_frequency` **only** | twelve fake MISSED cells per member, every month |

Both were correct *before* a tenant-level schedule existed — `deposit_frequency` was the only
source of that fact. Because it defaults to `'monthly'` on every row, switching a tenant changed
nothing for them. This is precisely the "governance asks, the leaderboard forgets" partial-exemption
failure the single-gate design was written to prevent, and it made the feature actively unsafe to
enable: deposits would be accepted freely while members were suspended for not making them.

It also invalidated the premise of the H3 fix, which assumed the sweep skips these members (it
would have released the holds, then re-held them on the next nightly run).

#### The fix

`GovernanceRulesSnapshot` gained `depositSchedule`, read from the settings row
`getGovernanceRules` **already selects** — the fix costs zero extra queries on both the sweep and
the matrix. New exported gate:

```ts
isMemberObligationEnforced({ depositSchedule }, depositFrequency)
```

which defers to the one canonical resolver. Absent settings row ⇒ monthly, so governance stays on
rather than switching itself off for an unprovisioned tenant. Call sites updated: the sweep loop,
both `toStatusSnapshot` callers (sweep + paged governance list, so `skippedFrequency` now reports
`"flexible-schedule"` instead of implying the member is monthly with no history), and the analysis
matrix.

`isMonthlySchedule` is now `@deprecated` with the reason inline — it answers "what does the member's
row say", which is a different question from "is this member obligated", and every production
consumer of it had needed the second question. It has **no remaining production caller**; it is kept
only for the byte-equivalence test.

#### Bulk R2

`bulkAddDeposits` now applies the same threshold, and a batch may legitimately **mix outcomes** —
three rows post as settled money and an oversized fourth is filed for approval. Pending rows advance
neither the running fund balance nor the member's contribution, so every `balanceBefore` /
`balanceAfter` snapshot in the batch stays truthful and the batch total credits only money that
actually moved. `totalContributed`, `lastDepositMonth` and `lastActive` are skipped for those rows,
they are written in the request shape for the existing approve/reject paths, and the audit records
`filedForApprovalCount` beside a settled-only `totalAmount`.

Errors caught in this step: a missing import, an object-literal type that had to be widened
(optional field, so the replay path is unaffected), and several malformed shell commands of mine
that swallowed verification output — no stub slips this session.

### State of the new deposit model
**Server-side: complete.** Phases 0–3, R1, R2 (single + bulk), plus this governance fix.

**Remaining — Phase 4 (UI) and Phase 5 (live-DB proof):**
1. Settings UI section for schedule + duplicate window + approval threshold + the 409 held-member
   confirmation flow. All four endpoints already support it.
2. i18n for every new string in `en/ur/hi/bn`.
3. H9 wording: where a flexible tenant shows `0` arrears / full compliance, the UI must say
   *not measured*, because a zero and an unmeasured value must not look identical.
4. H6 bulk grid progress display.
5. Phase 5 needs a real database: dual-run reconciliation, concurrency, cross-tenant isolation.

Migration `0025` remains unexecuted.
### Phase 4 landed (settings UI + i18n + H9) — 29-10-2026, session 8

**Verified: `tsc` 0 errors · `vitest` 57 files / 669 tests green · JSON valid in all 4 locales ·
`validate-i18n` reports 0 errors from any file this work touched.**

#### Settings UI — `app/settings/page.tsx`
New **Deposit Schedule** section in the Governance tab:
- Segmented **Monthly / Flexible** control (two-value enum shown with its consequences
  visible, rather than hidden behind a dropdown).
- **Near-duplicate warning window** (0–30 days) and **flexible approval threshold**.
- **Two-click confirmation** for a switch to flexible: the first Save arms an amber notice
  explaining that held members will be released and won't be re-held; the second sends
  `confirmDepositScheduleSwitch`. Changing the choice disarms it, so an operator can never
  acknowledge one option and save another. This is a courtesy layer — the server's 409 stays
  authoritative and does not trust the form to have asked.
- Blank threshold is sent as **`null`, never `0`** — the two mean opposite things (disabled vs.
  approve-everything) and the distinction is preserved through load and save.
- Both type declarations updated (`SettingsResponse.governance` and `BodyProps.gov`).

#### i18n — 41 new keys × 4 locales
Added by script, not by hand, because these files carry RTL and Indic scripts where one stray
character breaks an entire locale. The script refuses to write unless the file already round-trips
as canonical 2-space JSON and refuses to clobber an existing key.

**Caveat for review: the `ur`/`hi`/`bn` strings are machine-produced and need a native speaker's
pass.** English is authoritative; every call site also passes a `defaultValue`, so a rough
translation degrades gracefully rather than showing a raw key.

#### H9 — unmeasured must not read as healthy
Found already largely handled: `collectionEfficiency` is **`null`** (rendered "—") when
`totalExpectedSlots === 0`, and a fully flexible tenant now produces exactly that because the
tenant-aware matrix skips obligation slots. So the dangerous case — a `0` read as perfect
compliance, or as catastrophic failure — was prevented by the session-7 governance fix rather than
needing new logic.

What was missing was *explicitness*, so the analysis API now returns
`depositModel: { schedule, obligationMeasured }` — asked through the same canonical gate with a
`null` member frequency, not by re-reading the column — and the payment-matrix section shows a note
explaining that an empty grid is expected, not a problem. The type field is optional so cached
responses predating it are read as monthly, the stricter interpretation.

#### Errors caught this session (all mine, none shipped)
A `depositModel` field that swallowed `metrics.totalShareholders` into the wrong object; a junk
`void monthly;` statement injected in place of the variable I meant to define; a missing
Bengali key; and four more truncated-stub slips (now eight across the engagement), each caught by
typecheck or by reading back my own edit.

### Still remaining
**H6 only** — the bulk single-member month grid showing per-period *progress* (count and total per
month) for flexible members instead of a bare selectable/unselectable cell. It is display polish:
the grid already behaves correctly, because an empty occupancy map for a flexible member means
nothing is greyed out, which is the right answer. Doing it properly needs a new aggregate
read (count + sum grouped by period, independent of enforcement), a widened cell shape, and one
more i18n key set — deliberately not bolted on at the end of a long session.

Also outstanding and not code: run migration `0025`, and Phase 5's live-database proof (dual-run
reconciliation, concurrency, cross-tenant isolation).

### H6 landed (per-period progress) — 29-10-2026, session 9

**Verified: `tsc` 0 errors · `vitest` 57 files / 678 tests green · eslint 0 errors on every file
touched (1 pre-existing `react-hooks/incompatible-library` warning at `deposit-modal.tsx:133`, a
react-hook-form `watch()` note on a line this work did not touch) · `i18n:validate` 45 errors, all
pre-existing in `app/admin/*` + `components/admin/*`, 0 from this work · all four locale files
clean of foreign-script codepoints.**

#### The read — `lib/deposit-month-limit.ts`
`findDepositPeriodProgressInRange` + its exported condition builder and field map. `GROUP BY` the
canonical month expression, `count(*)::int`, `coalesce(sum(amount), 0)`, settled rows only.

Three decisions worth reviewing:

- **No `enforced` parameter.** Progress is a measurement, not a restriction, and gating it is
  exactly the harm this item describes. The shared `SETTLED_STATUS_CONDITION` was extracted from
  `OCCUPYING_STATUS_CONDITION` so the two reads cannot disagree about what "settled" means — the
  Phase 0 golden SQL is byte-identical after that refactor, which is what made the extraction safe
  to do at all.
- **No `LIMIT`.** The occupancy finder above documents why a limit there was a real bug; a counter
  has the same failure in a worse form.
- Pending requests are deliberately excluded: a request is not money, and counting it would put a
  figure beside a month that the fund balance does not contain.

#### The grid — `getMemberDepositMonths`
Each cell gains `depositCount` / `periodTotal`, **nullable**, plus the payload gains
`depositSchedule` + `obligationEnforced`. The aggregate is skipped by a ternary on
`gridSchedule.enforced`, so **a monthly grid issues exactly the queries it issued before this
feature existed** and reads `null` rather than a fabricated zero. `null` means "not measured",
which is not the same fact as `0` — the same distinction H9 is about.

#### The UI — both month grids
- Bulk sheet: a selectable month that already holds settled money shows
  `N · Deposited` (existing label + the count) and the period total in the amount column. It never
  shows the lock. The "months that already hold a deposit are locked" hint is replaced by
  `monthsHintFlexible`, and the trailing "Locked months already hold a deposit" note is **not
  rendered at all** for a flexible schedule — a false sentence does not need translating, it needs
  removing.
- Deposit form: month captions show the same figures, attached only on the not-occupied branch, so
  the monthly caption and its `disabled` rule are untouched.
- A payload from a server predating the field is read with `typeof … !== "number"`, so it renders
  nothing rather than `undefined`.

#### i18n — 1 new key, and a class of defect closed
`deposits.bulkSingle.monthsHintFlexible` in all four locales. The first attempt at the Urdu, Hindi
and Bengali strings was **written, then deleted**: an audit that compares every codepoint in each
locale file against the same file at `git HEAD` showed my typed Bengali contained Cyrillic
`о/н/а` and Assamese `ৰ`. `ur`/`hi`/`bn` now get the **first sentence of their own existing
`monthsHint`**, cut programmatically at that script's full stop — correct script by construction,
and it is the sentence that drops the now-false "months are locked" clause.

The same audit also found and repaired defects from an **earlier** session that no reading of the
text would have caught: 10 × Assamese `ৰ` (U+09F0) that should be Bengali `র` (U+09B0) in
`analysis.depositModelNotMeasured` etc., and 1 × Arabic U+06D2 inside a Devanagari word in
`settings.governance.depositScheduleHint.flexible`. Both were single-codepoint swaps of characters
that do not exist in these files at HEAD, so nothing legitimate could be touched.

**The native-speaker review of `ur`/`hi`/`bn` is still outstanding.** This audit proves the scripts
are right; it cannot prove the grammar is.

#### Tests
`__tests__/deposit-month-limit.characterisation.test.ts` → *per-period progress (H6)*: exact golden
of the rendered statement (including the fact that drizzle renders the selected month expression
**unqualified**, which is only safe while the query is single-table — locked as a note so a future
JOIN fails loudly), settled-only, no LIMIT, empty-period short-circuit proven with the
no-round-trip Proxy, and the map contract.
`__tests__/bulk-single-member-months.test.ts` → *per-period progress on a flexible grid (H6)*: the
ternary that keeps monthly free of the extra read, nullable cells on both interfaces, and the two
renderers.

#### Separate finding — wrong-script characters already in `ur`/`hi` (NOT from this feature)
The same audit run against the whole file found **9 strings that were already corrupted at HEAD**,
i.e. they ship today. Each has characters from a foreign script sitting inside a word:

| Locale | Key | Defect |
| --- | --- | --- |
| `ur` | `common.errors.failedToLoadDividendHistory` | Devanagari inside Urdu — `लाभ हिस्ट्री` |
| `ur` | `reports.types.memberContribution` | Katakana — `کントربیوشن` |
| `ur` | `reports.descs.memberContribution` | Malayalam — `شےयर` |
| `ur` | `reports.descs.roiAnalysis` | Telugu — `रిటرن` |
| `ur` | `erp.dataTable.clearSelection` | Devanagari letters inside the Urdu word for "selection" |
| `ur` | `admin.users.title` | Kanji — `全体` before the Urdu word |
| `hi` | `documents.contributionFootnote` | Arabic inside Devanagari — `रसद` |
| `hi` | `documents.pendingBanner` | same |
| `hi` | `analysis.notEvaluated` | Bengali matra — `नहੀं` |

**Not fixed here.** Repairing them needs a translation decision per string, not a codepoint swap,
and guessing at financial UI copy is worse than leaving it flagged. Listed for the native-speaker
pass, which is already outstanding.

### Still remaining after session 9
Only **Phase 5**, which cannot be done in this environment: it needs a live database for dual-run
reconciliation from a pre-switch ledger copy, concurrency (parallel same-member deposits never
double-credit; a monthly tenant never loses its 409), cross-tenant schedule isolation, and proof
that the suspended-member block still fires under flexible. Plus three operational items:
migration `0025` is unexecuted, the `ur`/`hi`/`bn` native review (including the 9 strings above),
and the pre-existing `i18n:validate` 45 admin errors + 1 lint warning that keep Pre-Flight from
going fully green independently of this work.
### Signup now asks for the deposit model — 29-10-2026, session 10

**Verified: `tsc` 0 errors · `vitest` 57 files / 686 tests green (+5) · eslint 0 errors (same single
pre-existing RHF `watch()` warning) · `i18n:validate` still exactly 45 pre-existing admin errors, 0
new — because this feature added 0 strings.**

A society that has never done monthly deposits previously had to onboard as monthly and then pay the
switching cost (held members released, 409 acknowledgement) to say so. Now it says so on the form.

#### Path
`app/signup/page.tsx` → `POST /api/auth/signup` → `provisionTenant({ financial })` →
`resolveFinancialDefaults` → `system_settings.deposit_schedule`.

- **`lib/org-setup.ts`** — `DEFAULT_DEPOSIT_SCHEDULE`, `DEPOSIT_SCHEDULES` (value + `labelKey` +
  `hintKey`) and `DEPOSIT_SCHEDULE_VALUES`. Values come from `DEPOSIT_SCHEDULE`, so signup cannot
  offer a schedule the resolver would not recognise. `FinancialDefaults`/`...Input` gain
  `depositSchedule`; `resolveFinancialDefaults` **rejects** anything outside the vocabulary
  (`[Field 'depositSchedule', Code: invalid_schedule]`) rather than normalising it — unlike the
  runtime resolver, which fails a *stored* unknown value closed to monthly, because at provisioning
  there is nothing to fail closed from and a silent default would hide a client bug.
- **`app/api/auth/signup/route.ts`** — `oneOf([...DEPOSIT_SCHEDULE_VALUES], 'depositSchedule')
  .default(DEFAULT_DEPOSIT_SCHEDULE)`. **Optional on the wire** like every other onboarding default,
  so older clients and the SuperAdmin route still provision successfully as monthly. Only the human
  form is forced.
- **`lib/tenant-provision.ts`** — the `systemSettings` insert writes `depositSchedule`.

#### The form (§15: no pre-selection)
Two cards in the financial step, rendered from `DEPOSIT_SCHEDULES`, starting **unselected**; the zod
field has no default, submit is `disabled` until answered, and each card carries the consequence
text. Deliberate, because this one value decides whether the month rule and deposit governance ever
apply — and switching later has real effects on held members.

#### Zero new translations
The labels are the **existing** `settings.governance.depositSchedule`,
`depositScheduleValue.{monthly,flexible}` and `depositScheduleHint.{monthly,flexible}`, plus
`common.selectPlaceholder` for the unanswered prompt. Signup and Settings therefore describe the same
setting in the same words in all four locales, and the outstanding native-review backlog does not
grow. This is the rule learned the hard way last session: reuse verified locale text over inventing
foreign-language strings.

#### Tests (+5)
`lib/org-setup.test.ts`: explicit `flexible` survives instead of being overwritten by the default;
junk/wrong-type/whitespace rejected with the §11 field code; `""` and absent → monthly; `" flexible "`
is trimmed then accepted (trim happens **before** the vocabulary check — case is still significant);
the option list and the validator share one vocabulary and Settings wording. The exact-object
characterisation test was updated deliberately, since provisioning now returns one more field.
`__tests__/deposit-schedule-exemptions.test.ts`: route declares+forwards the field, provisioning
writes the column and resolves it *before* `db.transaction(`, the form has **no** default entry
(the §15 proof) and disables submit while unanswered.

**One assumption my own test caught as wrong:** I wrote a provisioning-level rejection test assuming
`resolveFinancialDefaults` runs before any DB access. It does not — `getDb()` at
`lib/tenant-provision.ts:191` runs first, so that test reached `DATABASE_URL` instead. It still
validates *before the transaction opens* (line 221 < 225), which is the property that matters, so the
case was replaced by the ordering assertion above rather than kept as a false claim.

### Still remaining after session 10
1. Run migration `0025` — nothing here works until it does.
2. Phase 5 live-DB proof (see previous section).
3. Native review of `ur`/`hi`/`bn`, including the 9 pre-existing corrupted strings.
4. **New, small:** the SuperAdmin panel (`/api/admin/tenants/onboard`) forwards `financial` verbatim,
   so a platform-onboarded tenant can already be created flexible **via the API** — but the panel's
   own form has no control for it. One segmented input there would close the gap; today such a
   tenant can switch it after creation in Settings.
### Switching models can no longer rewrite the past — 29-10-2026, session 11

Raised by the owner as two questions: *should the deposit form still ask for a month when the tenant
is flexible?* and *should the model be locked in Settings after the first transaction, the way share
value is locked?*

**Verified: `tsc` 0 errors · `vitest` 59 files / 714 tests green (+14) · eslint 0 errors (the same
single pre-existing RHF `watch()` warning) · `i18n:validate` unchanged at 45 pre-existing admin
errors — this session added no strings.**

#### Decided against: the lock

`lib/utils/share-value-lock.ts` is not a "sensitive field" guard, it is a **conversion-factor** guard:
obligations are derived from `shares × shareValue` (`status-rules.ts`) and dividends are flat per
share, so editing the value silently re-prices the entire history. The flag is also *derived*, not
decided — `ensureShareValueLocked` sets it from the transaction count and the route refuses to unset
it because "the lock derives from ledger history".

The deposit model is a **policy about the future**. It does not change what a stored amount means.
Locking it permanently would force a society that chose wrong to migrate its ledger or abandon its
tenant — a worse outcome than the mistake. Kept: explicit choice at signup (session 10) + guarded
switch +, now, a switch that cannot rewrite the past.

#### The real defect the question exposed

`deposit_schedule_changed_at` was written at `app/api/settings/route.ts:424` and — verified across
`.ts/.tsx/.sql/.json/.mjs`, excluding build output — **read by nothing that drives behaviour**: only
returned in the settings GET payload and mentioned in one comment. Consequence: `getGovernanceRules`
judged the whole lookback window against the *current* schedule, so a tenant that ran flexible for
two years and then chose monthly got PARTIAL/MISSED for every month in the window on the next nightly
sweep, and could hold members for arrears that never existed. Signup choice did not protect against
this; only never switching did.

#### Fix: clamp the window, in one place

`lib/governance/status-rules.ts`

- `obligationStartPeriodKey({ depositSchedule, changedAt })` → the first month the monthly rule may
  be charged in, or null. Null when the tenant is flexible, has never switched, or the stamp is
  unusable (falls back to no clamp, i.e. governance stays on).
- **The floor is the month AFTER the switch, not the month of it.** On a 20 October switch with the
  deposit due on the 10th, October's window closed before the tenant adopted monthly, so charging it
  would recreate the exact invented arrears this exists to prevent. Cost: at most one month of
  leniency when a switch lands on the 1st — the cheaper error by a wide margin, since it can never
  penalise anyone.
- `firstEnforcedPeriodKey({ asOfPeriodKey, windowMonths, depositSchedule, changedAt })` combines the
  rule window with that floor. **ONE definition**, because the deposit-legs query and the period
  evaluation must agree: if the query loaded a narrower window than the evaluation judged, a month
  holding real money would come back empty and be reported as MISSED.

Consumers now on it: `evaluateMemberFromLegs` + `loadDepositLegsForMembers` (so the nightly sweep,
the paginated governance list and the per-member history all inherit it),
`lib/governance/performance.ts` scoring, and the Analysis payment matrix / collection efficiency via
`obligationStartPeriodKey` directly (its window is the 12 FY slots, not a lookback).

`MAX_WINDOW_MONTHS` moved from `status-service.ts` to `status-rules.ts` — the cap is now shared by
the guard loop and the clamping, so they cannot disagree about how far back a window reaches.

#### Two further defects found while doing it

1. **`buildPeriodRequirements` walked forward into the future.** With a start after the end it never
   hit its break condition, ran to the guard limit and returned ~60 *future* periods. Previously
   unreachable; the clamp made it reachable. Now returns an empty window, which reads correctly as
   "nothing is owed yet" rather than "perfectly compliant".
2. **An unmeasured deposit score awarded 60 free points.** `depositScore` falls back to 100 so the
   arithmetic stays finite, and the overall score gated that on `depositEnforced` — so a member with
   zero evaluated months (a monthly window lying entirely before its own switch, or a member who
   joined after the window opened) received 0.6 × 100 for punctuality that was never measured. Now
   gated on `depositMeasured = depositEnforced && evaluatedMonths > 0`, and `attendanceMetrics.weight`
   reports 100 in that case instead of a constant 40. Same principle as the NULL leaderboard score
   (H2): unmeasured must never read as compliant.

#### Month selection under flexible: kept, but no longer a blind choice

Kept, because the month is the **attribution** dimension, not the constraint: `deposit_month` decides
which fiscal year the money lands in via `assertFiscalPeriodOpen`, a NULL value disappears from the
`gte/lte` analytics filters (H7), and the matrix / per-period totals key off it. Stripping the
constraint must not strip the dimension.

What changed in `components/deposits/deposit-modal.tsx`: under a flexible schedule the field is now
**derived from the collected date** the officer already typed (the server stamps `transactions.date`
from that same field) and stays fully editable and visible. Making them pick a period from blank
added a click and a new way to be wrong — a `deposit_month` disagreeing with the date silently
relocates money between fiscal years, and under flexible there is no obligation for it to disagree
with. Monthly tenants are untouched (`derivedMonth` stays empty), and monthly keeps the deliberate
blank choice because "paying June's instalment in July" is a real act there.

Two guards on the derivation: it only applies when the derived period is one the picker can actually
display (a deposit back-dated across a year boundary stays an explicit choice), and an ISO
`YYYY-MM-DD` value is sliced rather than parsed, because `new Date("2026-10-01")` is UTC midnight and
reading `getMonth()` in a negative-offset timezone would file it in September.

#### Deliberately NOT done

- **No lock, in either direction** — see above. Revisit only if a tenant is ever found to have
  switched twice and been damaged by it.
- **No new Settings copy** explaining "obligations start next month". It needs four locales, which is
  the class of string this project has already had corrupted-character incidents with. Flagged for
  the outstanding native review instead.
- **No dedicated `DEPOSIT_SCHEDULE_CHANGED` audit action.** The switch is already captured by the
  `UPDATE_SETTINGS` audit row, which carries the before/after of the patch; a second row would
  double-log one write for a marginal searchability gain.
- **`monthsWithoutDeposit` (inactivity) is NOT clamped**, deliberately. It measures dormancy from the
  member's last actual deposit, not from an obligation, so it invents no arrears — and members of a
  flexible tenant are already exempted from the monthly rules entirely.

### Still remaining after session 11
1. Run migration `0025` (still unexecuted — nothing in this feature works until it does).
2. Phase 5 live-DB proof. One item there is now specifically: **switch a monthly tenant to flexible
   and back mid-window, then re-run the sweep and confirm the pre-switch months stay unjudged.**
3. Native review of `ur`/`hi`/`bn`, including the 9 pre-existing corrupted strings.
4. SuperAdmin panel still has no deposit-model control (its API already accepts one).
