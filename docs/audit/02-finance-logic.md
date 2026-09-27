# Audit 02 — Money Math, Share Accounting & Finance Business Logic

**Scope:** `lib/money.ts`, `lib/shares.ts`, `app/api/finance/**`, `app/api/dividends/**`, `app/api/deposits/**`, `app/api/funds/**`, `app/api/transactions/**`, governance penalty money path, `db/schema` finance tables, and `server/src/modules/finance|fiscal` as behavioral reference.
**Method:** static read + arithmetic. No source file was modified. `tsc`/`lint`/vitest were already green, so all findings below are semantic.

> **Architectural finding first (affects every other item):** the briefing states `server/src` is dead legacy. It is not dead for the finance surface. `tsconfig.json:26-27` maps `"@/server/*" -> ["./server/src/*"]`, and **every** route under `app/api/finance/**` is a two-line adapter onto `server/src/modules/finance/handlers.ts` (e.g. `app/api/finance/deposits/[id]/approve/route.ts:2`), which dispatches to `server/src/modules/finance/service.ts`. So `server/src/modules/finance/service.ts` is *live production money code* and is graded as such in this report, not as a reference.

## Summary
| Severity | Count |
|---|---|
| Critical | 7 |
| High | 12 |
| Medium | 8 |
| Low | 3 |
| **Total** | **30** |

Headline: the money primitives are excellent (`lib/money.ts` is exact, integer-only, and largest-remainder; `db` money columns are `decimal(15,2)`, shares are `integer`). **The failures are almost entirely in the write paths** — unlocked read-modify-write on balances, missing status re-checks inside the transaction, missing idempotency, and money rows written without a `tenant_id`. Any two concurrent requests touching money can create or destroy it.

## Money-flow map

| Endpoint | Money tables mutated | Transactional? | Row locks? | Idempotent? |
|---|---|---|---|---|
| `POST /api/deposits` (`app/api/deposits/route.ts:241-284`) | `transactions` (ins), `funds.balance`, `members.totalContributed` | yes (`db.transaction` @247) | **no** — fund/member read @217-236 *before* tx | no |
| `PUT /api/deposits/[id]/approve` (`[id]/approve/route.ts:86-124`) | `transactions.status`, `funds.balance`, `members.totalContributed` | yes (@99) | **no** — fund read @59, status check @42 both pre-tx | **no** — no `for('update')`, no in-tx status recheck |
| `POST /api/deposits/[id]/reject` | `transactions.status/description` | no | no | no |
| `POST /api/transactions` (`app/api/transactions/route.ts:147-213`) | `transactions` (ins) only — **no fund/member effect**; `system_settings` (all tenants) | **no** | n/a | no |
| `DELETE /api/transactions/[id]` | `transactions.isDeleted` only — **no money reversal** | no | no | no |
| `PUT /api/finance/deposits/[id]/approve` → `service.ts:610-700` | `transactions`, `funds.balance`, `members.totalContributed` | yes | **yes** (`.for('update')`, in-tx status recheck @633-637) | no |
| `PUT /api/finance/deposits/[id]` → `service.ts:480-608` | same + `funds.balance` | yes | partial | no |
| `DELETE /api/finance/transactions/[id]` → `service.ts:1090-1140` | `transactions`, `funds.balance`, `members.totalContributed` | yes | **no** (fund read @1101) | no |
| `POST /api/finance/equity/transfer` → `service.ts:1444-1556` | `transactions` (2 ins, **no tenant_id**), `members.shares`, `members.totalContributed` (×2) | yes | **no** (both members read @1454, no `for('update')`) | no |
| `POST /api/finance/earnings`, `POST /api/finance/expenses` → `service.ts:690-850` | `transactions`, `funds.balance`, `projects.*` | yes | fund unlocked (atomic `::numeric +`) — **good** | no |
| `POST /api/finance/dividends` → `service.ts:1310-1442` | `transactions` (N ins), `funds.balance` | yes | **no** — JS read-modify-write @1408 | no |
| `POST /api/dividends/distribute` (`app/api/dividends/distribute/route.ts`) | `profit_allocations`, `transactions` (N+2), `funds.balance` ×2, `members.totalContributed` ×N, `fiscal_periods` | yes (@129) — but **all balance sources read outside the tx** (@81, @99) | no | **no** — reference-number check @55-63 is a pre-tx SELECT with no unique constraint |
| `POST /api/funds/transfer` (`app/api/funds/transfer/route.ts`) | `funds.balance` ×2, `transactions` ×2 | yes (@102) | **no** | no |
| `POST /api/funds` → `funds/service.ts:90-120` | `funds` (**no `tenant_id`**), `transactions` (**no `tenant_id`**) | no | n/a | no |
| `PUT /api/funds/[id]` → `funds/service.ts:141-180` | `funds` metadata — **no tenant filter** | no | n/a | no |
| `POST /api/governance/penalties` | `members.totalContributed`, `warningCount`, `member_penalties` (**no `tenant_id`**) | yes | no (SQL arithmetic, unlocked) | no |
| `POST /api/governance/penalties/[id]/waive` | `members.totalContributed`, `member_penalties` | yes | **no** | **no** — no `for('update')` on the penalty |

## Findings

### [FIN-001] Deposit creation loses money via unlocked read-modify-write on fund balance — Severity: Critical
- **Location:** `app/api/deposits/route.ts:217-236` (reads), `app/api/deposits/route.ts:258-278` (writes)
- **Evidence:**
```ts
// line 228-232 — read OUTSIDE the transaction, no row lock
const [fund] = await db
  .select().from(funds)
  .where(and(eq(funds.id, fundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
  .limit(1);
...
// line 262-268 — inside db.transaction, but the new value was computed in JS
await tx.update(funds).set({
  balance: (toNum(fund.balance) + toNum(amount)).toFixed(2),
  updatedAt: new Date(),
}).where(eq(funds.id, fund.id));
// line 272-278
await tx.update(members).set({
  totalContributed: (toNum(member.totalContributed) + toNum(amount)).toFixed(2),
  updatedAt: new Date(),
}).where(eq(members.id, member.id));
```
- **Impact:** classic lost update. The fund balance is real money. **Arithmetic:** fund holds `1,000.00`. Cashier A and Cashier B each record a `500.00` deposit one second apart; both read `balance = "1000.00"`; both write `1500.00`. The fund ledger says `1,500.00`, the bank account received `2,000.00`. `500.00` of real cash is unaccounted for and the member's `totalContributed` is short by `500.00`, so their equity and dividend entitlement are both understated. The same window breaks against a concurrent approval, expense, or transfer. Compare `service.ts:660-666`, which uses the correct atomic form `sql\`(${funds.balance}::numeric + ${amountCents/100})::numeric(15,2)\`` — this route does not.
- **Fix:** inside `db.transaction`, lock the rows (`tx.select().from(funds).where(eq(funds.id, fundId)).for('update')`) **and** write the balance with SQL arithmetic, never a JS-computed literal: `balance: sql\`(${funds.balance}::numeric + ${centsToDecimalLiteral(amountCents)})::numeric(15,2)\``. Do the same for `members.totalContributed`.

### [FIN-002] Deposit approval can credit the same payment twice (TOCTOU on status) — Severity: Critical
- **Location:** `app/api/deposits/[id]/approve/route.ts:42-44` (check), `:59-63` (fund read), `:96-124` (writes)
- **Evidence:**
```ts
// line 42-44 — outside db.transaction (tx starts at line 99)
if (deposit.status !== 'PENDING') {
  throw new ValidationError('Only pending deposits can be approved');
}
...
// line 59 — fund read before the tx, unlocked
const [fund] = await db.select().from(funds).where(and(eq(funds.id, deposit.fundId!), ...)).limit(1);
...
// line 115-117 — status set unconditionally, no re-check inside the tx
await tx.update(transactions)
  .set({ status: 'Completed', approvedBy: user.id, approvedAt: new Date() })
  .where(eq(transactions.id, depositId));
```
- **Impact:** a retried/duplicated approval (double-clicked button, client retry, browser resend) passes the pre-transaction `PENDING` check twice. **Arithmetic:** a member's `500.00` bank transfer is pending approval. Two concurrent approvals both observe `status = 'PENDING'`, both credit the fund: `1,000.00 + 500.00 + 500.00 = 2,000.00` credited for `500.00` of cash. `500.00` is **created from nothing** and the member's `totalContributed` becomes `1,000.00` for a `500.00` payment. This is a direct duplicate-payment defect and it is a regression against the reference implementation, which does it correctly: `service.ts:633-637` selects the deposit `.for('update')` **inside** the transaction and re-checks `status === 'PENDING'` there.
- **Fix:** move the read into the transaction with `tx.select().from(transactions).where(and(eq(transactions.id, depositId), eq(transactions.tenantId, tenantId))).for('update')` and re-check status there; make the final `UPDATE ... WHERE id = ? AND status = 'PENDING' AND RETURNING` so a second attempt affects zero rows.

### [FIN-003] Two different delete paths for the same money: one does nothing, the other reverses twice — Severity: Critical
- **Location:** `app/api/transactions/[id]/route.ts:109-119` (soft delete), `server/src/modules/finance/service.ts:1090-1140` (reversing delete, reachable at `app/api/finance/transactions/[id]/route.ts:8`)
- **Evidence:**
```ts
// app/api/transactions/[id]/route.ts:109-119
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await getAuthContext(request);
    ...
    await db.update(transactions)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id, deletionReason: reason })
      .where(eq(transactions.id, id));
    return NextResponse.json({ success: true, message: 'Transaction deleted successfully' });
```
```ts
// server/src/modules/finance/service.ts:1101-1118 — the other delete
const [fund] = await tx.select().from(funds).where(eq(funds.id, transaction.fundId!)).for('update');
if (fund) { const restored = toCents(fund.balance) - toCents(transaction.amount);
  await tx.update(funds).set({ balance: fmt(restored) }).where(eq(funds.id, fund.id)); }
```
- **Impact:** two critical consequences. (a) **Money destruction:** `DELETE /api/transactions/[id]` soft-deletes a *completed* `5,000.00` deposit and reverses nothing. The row disappears from every report (`is_deleted = false` filters) and from `SUM(amount)` totals, but the `funds.balance` still contains the `5,000.00`. The fund now permanently fails reconciliation by exactly `5,000.00` and the member keeps the equity. (b) **Money duplication:** the legacy select at `service.ts:1090-1099` filters only on `id` and `tenant_id` — **it does not check `isDeleted`**. So soft-deleting through `/api/transactions/[id]` and then calling `DELETE /api/finance/transactions/[id]` on the same id subtracts the amount from the fund a **second** time: `10,000.00` fund − `5,000.00` (payment received) − `5,000.00` (first "delete", no effect) − `5,000.00` (second "delete", effect) = `0.00`. `5,000.00` vanishes.
- **Fix:** collapse to a single money-aware delete that always reverses the fund and the member, run in one transaction with `for('update')` on the transaction row, and refuse to run twice (`WHERE id = ? AND is_deleted = false` + `RETURNING`). If soft delete must stay, it must never be reachable for `status = 'Completed'` money-bearing rows.

### [FIN-004] Fund-to-fund transfer can over-debit the source fund — Severity: Critical
- **Location:** `app/api/funds/transfer/route.ts:70` (balance read), `:93-99` (check), `:118-130` (writes)
- **Evidence:**
```ts
// line 70 — read before the transaction, unlocked
const [fromFund] = await db.select().from(funds).where(eq(funds.id, fromFundId)).limit(1);
...
// line 93-99 — sufficiency checked in JS, before the tx
const availableBalance = toNum(fromFund.balance);
const transferAmount = toNum(amount);
if (transferAmount > availableBalance) {
  throw new ValidationError(`Insufficient balance. Available: ${availableBalance}`);
}
...
// line 118-124 — inside tx, JS-computed literal
await tx.update(funds).set({ balance: (toNum(fromFund.balance) - transferAmount).toFixed(2) }).where(eq(funds.id, fromFundId));
await tx.update(funds).set({ balance: (toNum(toFund.balance) + transferAmount).toFixed(2) }).where(eq(funds.id, toFundId));
```
- **Impact:** **Arithmetic:** the treasury fund holds `10,000.00`. Two concurrent `5,000.00` transfers are submitted (e.g. two officers paying two vendors at the same time). Both read `10,000.00`, both pass the `5,000.00 > 10,000.00` check as false, both write `5,000.00`. The source fund is debited `10,000.00` on paper and `5,000.00` in the bank, and the destination fund is credited `10,000.00` for `5,000.00` actually received — `5,000.00` of phantom cash created. Also note the two transactions are typed `'Transfer Out'` / `'Transfer In'` (`route.ts:104-118`), which no reporting path counts (see FIN-015).
- **Fix:** `for('update')` both fund rows inside the transaction, re-check sufficiency there, and express both writes as SQL arithmetic.

### [FIN-005] Waiving a governance penalty creates money that was never collected — Severity: Critical
- **Location:** `app/api/governance/penalties/[id]/waive/route.ts:36-58` (restore), `app/api/governance/penalties/route.ts:170` (the clamp that made the deduction smaller)
- **Evidence:**
```ts
// waive/route.ts:36-45 — penalty read inside the tx but NOT locked
const [penalty] = await tx.select().from(memberPenalties).where(eq(memberPenalties.id, id)).limit(1);
if (!penalty) throw new NotFoundError('Penalty');
if (penalty.status === 'WAIVED') throw new ValidationError('Penalty is already waived');
const deduction = Number(penalty.calculatedDeduction || 0);
...
// waive/route.ts:51-58 — restores the *recorded* figure, not what was actually taken
await tx.update(members)
  .set({ totalContributed: sql<string>`(${members.totalContributed}::numeric + ${deduction})::numeric(15,2)`, ... })
  .where(eq(members.id, penalty.memberId));
```
```ts
// penalties/route.ts:170 — the actual debit is CLAMPED at zero, but the stored figure is not
totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${calculatedDeduction}))::numeric(15,2)`,
```
- **Impact:** the two sides disagree, and the `GREATEST(0, ...)` clamp silently makes them disagree. **Arithmetic:** a member has contributed `1,000.00`. A `5,000.00` `FUND_DEDUCTION` penalty is issued. The real debit is clamped: `GREATEST(0, 1000.00 − 5000.00) = 0.00`, so the member loses only `1,000.00` — but `calculatedDeduction` is stored as `5000.00` (`penalties/route.ts:198`). The penalty is later waived: `totalContributed = 0.00 + 5,000.00 = 5,000.00`. The member's paid-in capital is now `5,000.00` for `1,000.00` of actual cash, and their share of every future dividend is inflated 5×. **`4,000.00` of phantom equity.** Compounding it, the penalty row is not locked `for('update')`, so two concurrent waive calls both pass the `status === 'WAIVED'` check (`waive/route.ts:43`) and restore twice: `0.00 + 5,000.00 + 5,000.00 = 10,000.00`.
- **Fix:** store the *effective* deduction actually applied (re-read `GREATEST` result inside the transaction and persist that, or `UPDATE … RETURNING` the post-deduction contribution), and refuse to issue a fine larger than the member's contribution in the first place. On waive, restore only the stored effective amount, and lock the penalty row `.for('update')` before the status check.

### [FIN-006] Deleting a deposit wipes a member's dividend and equity-transfer equity — Severity: Critical
- **Location:** `server/src/modules/finance/service.ts:1124-1138` (recompute inside `deleteTransaction`)
- **Evidence:**
```ts
const [remaining] = await tx
  .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')` })
  .from(transactions)
  .where(and(
    eq(transactions.memberId, transaction.memberId),
    eq(transactions.tenantId, tenantId),
    eq(transactions.type, 'Deposit'),
    inArray(transactions.status, ['Completed'])
  ));
await tx.update(members)
  .set({ totalContributed: (Math.round(toNum(remaining.total) * 100) / 100).toFixed(2) })
  .where(eq(members.id, transaction.memberId));
```
- **Impact:** the recompute rebuilds `totalContributed` from **`type = 'Deposit'` only**, but the codebase credits a member's contribution from at least three other sources. **Arithmetic:** a member has one completed `10,000.00` deposit; `POST /api/dividends/distribute` pays them a `2,500.00` dividend and writes `totalContributed = 12,500.00` (`app/api/dividends/distribute/route.ts:250-258`); `POST /api/finance/equity/transfer` later credits another `1,000.00` (`service.ts:1539-1550`) → `13,500.00`. The member then requests deletion of the `10,000.00` deposit. The recompute yields `SUM(deposits) = 0.00`. The member's equity drops from `13,500.00` to `0.00` in one request, and their dividend entitlement goes to nil. Worse, the reference invariant in `server/src/db/verify-complete-math.ts` also excludes dividends (`SUM(Deposit) - SUM(Governance Fine)`), so this endpoint and that audit disagree by construction. The recompute also silently drops any deposit whose status was set to `'Success'` — accepted as completed by `service.ts:637` and by the `isNowCompleted` check at `service.ts:527` — since the filter is `IN ('Completed')` only.
- **Fix:** recompute from the full set of contribution-affecting types (`Deposit`, `Dividend`, `Equity Transfer In`) with a single grouped `SUM … GROUP BY memberId`, and treat `'Success'` as completed. Better: stop denormalising — derive member equity from the ledger.

### [FIN-007] Dividend run updates the fund balance by JS read-modify-write, so it races every other writer — Severity: Critical
- **Location:** `server/src/modules/finance/service.ts:1399-1411`
- **Evidence:**
```ts
// line 1399 — fund read, NO row lock
const [fund] = await tx.select().from(funds).where(and(eq(funds.id, sourceFundId), eq(funds.tenantId, tenantId))).limit(1);
...
// line 1408-1411 — balance written as a JS literal
await tx.update(funds)
  .set({ balance: fmt(toCents(fund.balance) - totalDisbursedCents), updatedAt: new Date() })
  .where(eq(funds.id, sourceFundId));
```
- **Impact:** every other flow (`approveDeposit` `service.ts:660-666`, `addExpense` `service.ts:768-773`, `addEarning` `service.ts:820-825`, `transferEquity` `service.ts:1527-1534`, `app/api/funds/transfer`) writes the balance with atomic SQL arithmetic. This one does not, so it silently loses whichever write lands between its read and its write. **Arithmetic:** the fund holds `1,000,000.00`. A dividend run of `90,000.00` reads `1,000,000.00`; concurrently an expense of `100,000.00` commits via `balance = balance - 100000.00`. If the expense commits first, the dividend run then writes `1,000,000.00 - 90,000.00 = 910,000.00`, silently erasing the `100,000.00` expense. `100,000.00` of recorded spending vanishes from the fund balance while the expense row still exists. The reverse interleaving produces a `190,000.00` discrepancy instead.
- **Fix:** `for('update')` the fund row and write `balance: sql\`GREATEST(0, (${funds.balance}::numeric - ${decimalLiteral(totalDisbursedCents)})::numeric(15,2))\`` — the `fmt(...)` literal is the bug, the total cents value is already exact.

### [FIN-008] Dividend distribution uses float money math and `toFixed` for storage — Severity: High
- **Location:** `app/api/dividends/distribute/route.ts:39-41`, `:181-188`, `:199-203`, `:256-265`, `:290-293`
- **Evidence:**
```ts
// line 39-41
const grossEarnings = parseFloat(earnings.toString());
const statutoryReservePercent = parseFloat(
  String((settings as Record<string, unknown>)?.statutoryReservePercent ?? 0)
);
...
// line 200-203 — toFixed(2) result is what gets STORED, not displayed
const statutoryReserveAmount = (grossEarnings * (statutoryReservePercent / 100)).toFixed(2);
const netDistributable = grossEarnings - statutoryReserveAmount;
const netDistributableCents = toCents(String(netDistributable));
```
- **Impact:** `toFixed` is being used as a rounding mechanism on a binary double *before* it is written to `decimal(15,2)`, and the project's own rule (`AGENTS.md`, "never use float for money math") is violated — even though `lib/money.ts` (which is imported two lines away, `route.ts:12`) exists to prevent exactly this. The rounding is also **inconsistent in direction** and therefore not a fixed toll: `0.05 * (50/100)` is `0.025000000000000001387…` in binary → `toFixed(2)` = `"0.03"` (**over**-reserved by `0.01`), while `0.15 * (50/100)` is `0.074999999999999997224…` → `toFixed(2)` = `"0.07"` (**under**-reserved by `0.01`, whereas `Math.round(7.5)/100` correctly gives `0.08`). So a `50%` reserve on a `0.15` gross shortfall is under-reserved and a `50%` reserve on `0.05` is over-reserved — a non-reproducible statutory reserve. `statutoryReservePercent` is also read unvalidated from settings (`route.ts:39-41`), so a non-numeric setting yields `NaN` → `"NaN"` → `toCents` throws → the whole distribution 500s.
- **Fix:** `const grossCents = toCents(String(earnings))`, `const reserveCents = Math.round(grossCents * percent / 100)` (integer arithmetic — no float step), `const netCents = grossCents - reserveCents`, and pass `fromCents(...)` strings to every insert. Validate `percent` to `0..100` with Zod before use. This endpoint already uses `splitDividendByShares` correctly — the split is exact, only the reserve is not.

### [FIN-009] Dividend distribution reads and rewrites another tenant's fiscal period, and its period totals are a lost update — Severity: High
- **Location:** `app/api/dividends/distribute/route.ts:144-173` (lookup + insert), `:290-293` (write)
- **Evidence:**
```ts
// line 144-151 — no tenant filter
let [fiscalPeriod] = await db
  .select().from(fiscalPeriods)
  .where(and(eq(fiscalPeriods.year, currentYear), eq(fiscalPeriods.status, 'OPEN')))
  .limit(1);
if (!fiscalPeriod) {
  [fiscalPeriod] = await db.insert(fiscalPeriods)
    .values({ year: currentYear, startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31`, status: 'OPEN', totalEarnings: '0.00', totalDistributed: '0.00', totalExpenses: '0.00' })
    .returning();
}
```
- **Impact:** `fiscal_periods` is a per-tenant table (`db/schema/fiscal_periods.ts`, `tenantId` column + `uq_fiscal_periods_tenant_year` unique index). The lookup is unscoped, so in a multi-tenant deployment tenant B's dividend run can select and then `UPDATE` tenant A's period row, adding B's `totalEarnings` / `totalDistributed` to A's fiscal-year totals (line 290-293) — cross-tenant corruption of reported annual results. Even single-tenant, the totals are a read-modify-write: the period is read at line 144 and written at line 290 from the stale in-memory value with no lock, so two concurrent dividend runs in the same year publish a `totalDistributed` that equals only one of them. The auto-created period also omits `tenantId` (nullable column), so an unassigned period is invisible to every tenant-scoped query.
- **Fix:** add `eq(fiscalPeriods.tenantId, tenantId)` to the lookup, set `tenantId` on the insert, and update the totals with `sql\`total_distributed = total_distributed + ${n}\`` instead of a stale literal.

### [FIN-010] Money-bearing rows are inserted with no `tenant_id` and become invisible to every tenant-scoped query — Severity: High
- **Locations & evidence:**
```ts
// server/src/modules/finance/service.ts:1506-1517 and 1539-1550 — equity transfer legs
await tx.insert(transactions).values({
  memberId: targetMember.id,
  type: 'Withdrawal', amount: fmt(amountCents), description: `Equity transfer to ...`,
  date: new Date(), status: 'Completed', category: 'Equity Transfer',
  fundId: null, referenceNumber: ref, createdBy: user.id,
});
```
```ts
// app/api/dividends/distribute/route.ts:272-282
await tx.insert(profitAllocations).values({
  fiscalPeriodId: fiscalPeriod.id, memberId: member.id,
  allocationType: 'Dividend', amount: fmt(payoutCents),
  sharesAtTime: member.shares, ratePerShare: ..., notes: ...,
});
```
```ts
// app/api/governance/penalties/route.ts:190-204
const [penalty] = await tx.insert(memberPenalties).values({
  memberId, meetingId: meetingId || null, tier, title: penaltyTitle, type: penaltyType, ...
});
```
- **Impact:** `db/schema/transactions.ts:10` and `db/schema/profit_allocations.ts:9` declare `tenantId` as `uuid('tenant_id').references(() => tenants.id)` with **no `.notNull()`**, so Postgres silently accepts `NULL`. Every tenant-scoped ledger query filters `eq(transactions.tenantId, tenantId)` (`app/api/finance/transactions/route.ts:340`, `app/api/deposits/route.ts:44`), so an equity transfer of `25,000.00` from member A to member B is **written to the database and then never displayed, never totalled, and never reconciled** — it is missing from both the withdrawal-side and the credit-side of the ledger. `reconcileFund` (`service.ts:1600-1612`) filters `transactions.tenant_id = ${tenantId}`, so the fund is reported as fully reconciled while `25,000.00` of movement is absent from the ledger. The same applies to all `profit_allocations` rows written by the dividend run (invisible to every profit-allocation report) and every `member_penalties` row (invisible to the penalties list and to any penalty/arrears reconciliation).
- **Fix:** make `tenant_id` `NOT NULL` in the migration for `transactions`, `profit_allocations`, `member_penalties` and `funds`, and pass `tenantId` at every insert site. Until the migration lands, add an assertion in tests that no money-bearing row has `tenant_id IS NULL`.

### [FIN-011] `POST /api/transactions` writes ledger rows that move no money, and locks share value across every tenant — Severity: High
- **Location:** `app/api/transactions/route.ts:172-205`
- **Evidence:**
```ts
// line 172-175
const numAmount = Number(amount);
if (!type || !numAmount || numAmount <= 0 || !description) {
  throw new ValidationError('Valid transaction type, positive amount, and description are required');
}
// line 180-199 — ledger row only; no funds/members touch
const [created] = await db.insert(transactions).values({ tenantId: tenantId || null, type, amount: String(numAmount), ..., status: 'Completed', ... }).returning();
// line 202-205 — unconditional, unscoped write across ALL tenants
await db.update(systemSettings).set({ isShareValueLocked: true, updatedAt: new Date() })
  .where(eq(systemSettings.isShareValueLocked, false));
```
- **Impact:** (a) The row is marked `status: 'Completed'` but no `funds.balance` and no `members.totalContributed` is touched, so the amount appears in the ledger header totals (`app/api/transactions/route.ts:70-84` sums `inflow`/`outflow` for `('Deposit','Earning')` and `('Expense','Dividend','Disbursement')`) and in the fund's history, while zero money moved. **Arithmetic:** an officer records a `50,000.00` `Expense` here. The transactions page reports `totalOutflow` including `50,000.00`; the fund's `balance` is unchanged; `reconcileFund` computes `calculatedBalance` *from those same rows* (`service.ts:1600-1612`) and therefore reports the fund as `50,000.00` out of balance, permanently. (b) `Number()` accepts non-decimal-string input and `String()` re-serialises it: `Number("1e-7")` → `1e-7` → stored `"1e-7"` → coerced to `0.00`; `Number("Infinity")` → `Infinity`, which passes the `!numAmount` and `<= 0` guards and then makes Postgres raise on the numeric cast (500). There is no `parsePositiveAmount` (≤2dp) and no `MAX_AMOUNT` ceiling, unlike the legacy `positiveAmount` schema. (c) The three statements are not wrapped in a transaction: if the settings update or `logAudit` fails, the row is already committed. (d) `system_settings` is per-tenant (`db/schema/system_settings.ts`, `unique('uq_system_settings_tenant').on(table.tenantId)`) but line 205 has no `tenantId` predicate, so recording a transaction in one tenant sets `isShareValueLocked = true` for **every** tenant, permanently freezing every other club's share value. (e) `tenantId: tenantId || null` (line 183) is a non-fail-closed default, so a platform-level operator writes `NULL` rows (see FIN-010).
- **Fix:** either restrict this endpoint to a ledger-only annotation type that is excluded from all money totals, or route it through the same transactional writers as the other money types. Parse the amount with `parsePositiveAmount` and write `fromCents(cents)`; add `eq(systemSettings.tenantId, tenantId)`; wrap the writes in one transaction; require `tenantId`.

### [FIN-012] `GET /api/transactions` is not fail-closed on tenant scope — Severity: High
- **Location:** `app/api/transactions/route.ts:36-42`
- **Evidence:**
```ts
if (!includeDeleted) {
  conditions.push(sql`${transactions.isDeleted} = false`);
}

if (tenantId) {
  conditions.push(sql`${transactions.tenantId} = ${tenantId}`);
}
```
- **Impact:** a caller whose auth context has no `tenantId` (platform operator, misconfigured session) receives **every tenant's** money transactions, with `totalInflow` / `totalOutflow` / `netFlow` aggregated across all of them (`route.ts:70-84`, `:132-136`). This is a direct violation of the `AGENTS.md` rule "no unscoped tenant queries" and of the fail-closed pattern used one directory away (`app/api/deposits/route.ts:34-40` throws `'Tenant context required'`). Any user who can create a transaction can also enumerate the whole platform's ledger.
- **Fix:** `if (!tenantId) throw new ForbiddenError('Tenant context required')` before building conditions, matching `app/api/deposits/route.ts:34-40`.

### [FIN-013] Single-transaction GET/DELETE are unscoped and unauthenticated by permission — Severity: High
- **Location:** `app/api/transactions/[id]/route.ts:15-18` (GET auth), `:54` (GET query), `:100` (DELETE query)
- **Evidence:**
```ts
// line 15-18 — authentication only, no permission check at all
const { user, error } = await getAuthContext(request);
if (error || !user) {
  return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
}
...
// line 54 — lookup by id alone, no tenant predicate
const [transaction] = await db.select({ ... }).from(transactions)
  .leftJoin(members, eq(transactions.memberId, members.id))
  .leftJoin(funds, eq(transactions.fundId, funds.id))
  .where(eq(transactions.id, id)).limit(1);
...
// line 100 — same for the destructive path
.where(eq(transactions.id, id))
```
- **Impact:** any authenticated user of any tenant can read any transaction in the platform by UUID (member name, fund, amount, reference number, authorized-by) and can soft-delete it. A tenant-A member holding a UUID from a tenant-B receipt can erase tenant-B's audit record. This is the same endpoint as FIN-003, so the "unauthorized money action" is also an uncompensated one.
- **Fix:** add `and(eq(transactions.id, id), eq(transactions.tenantId, tenantId))` to both queries, fail closed on missing `tenantId`, and require the same permission the list endpoint requires.

### [FIN-014] Fiscal periods have no enforcement anywhere — closed years stay fully mutable — Severity: High
- **Location:** `db/schema/fiscal_periods.ts`; consumers are only `app/api/dividends/distribute/route.ts:145-148` and `server/src/modules/fiscal/service.ts`
- **Evidence:** a repo-wide search for `fiscalPeriods` / `fiscal_periods` returns **no** finance write path. The only status filter is the *selection* of an OPEN period for a dividend run:
```ts
// app/api/dividends/distribute/route.ts:145-148
.where(and(eq(fiscalPeriods.year, currentYear), eq(fiscalPeriods.status, 'OPEN')))
```
Meanwhile `LockedError` is imported into the deposit and transfer routes and **never thrown**:
```ts
// app/api/deposits/route.ts:18 (and [id]/approve, funds/transfer)
import { AppError, ValidationError, NotFoundError, ForbiddenError, LockedError } from '@/lib/utils/errors';
```
- **Impact:** `fiscal_periods` models an accounting year with a `status`, and the schema seeds `CLOSED` as a value, but nothing in the money path consults it. Consequently: a `CLOSED` 2025 can still receive a completed deposit, an expense, a backdated dividend distribution, or a mid-period edit. `editDeposit` (`service.ts:480-608`) will happily re-date and re-amount a 2025 deposit; `addExpense` (`service.ts:784`) and `editExpense` (`service.ts:820-834`) write a caller-supplied `date` with no range check. **Arithmetic:** a `50,000.00` expense is backdated into the closed 2025 period. The fiscal-year `totalExpenses` written by the dividend run (`route.ts:293`) and the expense row can disagree, because nothing validates that a 2025-dated write may still occur, and nothing recomputes the closed period. Locking share value via `system_settings.isShareValueLocked` is the *only* period-adjacent lock in the system, and FIN-011 shows it is itself set globally and without a transaction.
- **Fix:** centralise a `assertPeriodOpen(tenantId, date, db)` guard and call it at the top of every money write that accepts a `date`; add a `POST /api/fiscal/[year]/close` that sets `status='CLOSED'` and make `verify-complete-math.ts`'s invariants a pre-close gate.

### [FIN-015] Four inconsistent transaction-type → inflow/outflow mappings silently under-report money — Severity: High
- **Locations:** `app/api/transactions/route.ts:70-84`; `server/src/modules/finance/service.ts:352-353`; `server/src/modules/finance/service.ts:1604-1608`; `server/src/db/verify-complete-math.ts:118-125`
- **Evidence (the four lists, side by side):**
```ts
// app/api/transactions/route.ts:70-84
inflow:  sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Deposit','Earning') THEN ${transactions.amount} ELSE 0 END), 0)`,
outflow: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} IN ('Expense','Dividend','Disbursement') THEN ${transactions.amount} ELSE 0 END), 0)`,

// server/src/modules/finance/service.ts:352-353
sql`${transactions.type} IN ('Deposit','Earning','Investment')`,   // inflow
sql`${transactions.type} IN ('Expense','Withdrawal','Dividend')`,  // outflow

// server/src/modules/finance/service.ts:1604-1608 (reconcileFund)
CASE WHEN type IN ('Deposit','Earning') THEN amount ELSE 0 END     // inflow
CASE WHEN type IN ('Expense','Withdrawal','Dividend') THEN amount ELSE 0 END  // outflow

// server/src/db/verify-complete-math.ts:118-125
type IN ('Deposit','Earning')          // inflow
type IN ('Investment','Expense')        // outflow
```
- **Impact:** the *same money* is classified differently by each list, and the types actually written by live endpoints are missing from all of them. `POST /api/funds/transfer` writes `'Transfer Out'` / `'Transfer In'` (`app/api/funds/transfer/route.ts:104-118`) and `POST /api/dividends/distribute` writes `'Dividend Distribution'` and `'Statutory Reserve'` (`route.ts:245-254`) — none appear in any `IN (...)` list. **Arithmetic:** the treasury fund holds `1,000,000.00`. A `250,000.00` fund-to-fund transfer is recorded: it matches no list, so the transactions page's `totalOutflow` omits `250,000.00` and `netFlow` is overstated by `250,000.00`. A dividend run on `100,000.00` gross with a `10,000.00` statutory reserve debits the fund by the full `100,000.00` (`route.ts:184-188`) but the ledger's outflow only recognises the `90,000.00` of per-member `'Dividend'` rows — the aggregate `'Dividend Distribution'` row is not matched — so `reconcileFund` computes a balance `10,000.00` too high and reports `DISCREPANCY` forever. The reserve fund receives `10,000.00` under type `'Statutory Reserve'`, which is in no inflow list, so the reserve fund reconciles as `0.00` against a real `10,000.00`. `Investment` is an outflow in `verify-complete-math.ts` but an inflow in `service.ts:352-353` — the same row is counted in opposite directions by two auditors.
- **Fix:** define one authoritative, enumerated `TransactionType → direction` map in `lib/money.ts` (or a `lib/transaction-types.ts`), derive every one of the four lists from it, and make the DB reject unknown types with a `CHECK` constraint or an enum. Include `'Transfer Out'`, `'Transfer In'`, `'Dividend Distribution'`, `'Statutory Reserve'`, and make `'Investment'` a single agreed direction.

### [FIN-016] No money mutation is idempotent — every endpoint is double-submit unsafe — Severity: High
- **Locations:** `app/api/deposits/[id]/approve/route.ts:115-117`; `app/api/dividends/distribute/route.ts:55-63`; `server/src/modules/finance/service.ts:1503-1504`; `app/api/funds/transfer/route.ts:178-189`; `app/api/governance/penalties/[id]/waive/route.ts:43-45`
- **Evidence:**
```ts
// app/api/dividends/distribute/route.ts:55-63 — the only idempotency attempt, and it is a bare pre-tx SELECT
if (referenceNumber) {
  const [existing] = await db.select({ id: dividends.id }).from(dividends)
    .where(and(eq(dividends.tenantId, tenantId), eq(dividends.referenceNumber, referenceNumber))).limit(1);
  if (existing) throw new ValidationError('A dividend with this reference number already exists');
}
```
```ts
// server/src/modules/finance/service.ts:1503-1504 — timestamp-only batch id
const batchId = `EQT-${Date.now()}`;
```
- **Impact:** the dividend idempotency check is (a) skipped entirely when the client omits `referenceNumber`, in which case `route.ts:64` generates a random one per request, and (b) not backed by a unique constraint on `dividends(tenant_id, reference_number)` and not inside the transaction, so two concurrent runs both pass it and both distribute. The remaining endpoints have no guard at all: double-approving a deposit (FIN-002), double-transferring funds (FIN-004), double-waiving a penalty (FIN-005) and double-submitting an equity transfer all duplicate money. `EQT-${Date.now()}` also collides across two requests in the same millisecond, which will collide with any future unique constraint on `batchId`.
- **Fix:** require a client-supplied `idempotencyKey` (or reference number) on every money POST; store it with a `UNIQUE (tenant_id, idempotency_key)` constraint; return the original result on replay instead of re-executing. Replace `Date.now()` batch ids with a UUID.

### [FIN-017] Deposit totals include pending and rejected deposits — collected cash is overstated — Severity: High
- **Location:** `app/api/deposits/route.ts:41-45` (conditions), `:196-217` (aggregate)
- **Evidence:**
```ts
// line 41-45 — the status predicate is OPTIONAL and has no default
if (status) {
  conditions.push(eq(transactions.status, status));
}
...
// line 196-217 — aggregate mode sums every matching row
if (mode === 'aggregate') {
  const [agg] = await db.select({
    totalAmount: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(transactions).where(and(...conditions));
```
- **Impact:** the sibling ledger endpoint deliberately restricts totals to money that actually moved — `app/api/finance/transactions/route.ts:352-353` pairs its type list with `inArray(transactions.status, ['Completed','Processing'])`. The deposits aggregate has no such predicate, so unless the caller happens to pass `status=Completed` the header counts `PENDING` and `REJECTED` deposit requests as collected cash. **Arithmetic:** the club has actually collected `1,000,000.00` and has `200,000.00` of pending requests and `50,000.00` of rejected ones. `GET /api/deposits?mode=aggregate` without a `status` filter reports `totalAmount = 1,250,000.00` — `250,000.00` of money that never arrived. *Needs verification:* whether the client always sends `status`. What would confirm it: the network tab for the deposits page, or the query the client builds. If the client does send `status=Completed` today, this is latent rather than active, and the server should still not depend on the caller for correctness.
- **Fix:** default the aggregate to completed statuses inside the server (`inArray(transactions.status, ['Completed','Success'])`) and expose the pending/rejected breakdown as separate fields.

### [FIN-018] Amount ceilings are enforced on some write paths and absent on others — Severity: High
- **Locations:** `lib/money.ts` `MAX_AMOUNT`; enforced at `server/src/modules/finance/validation.ts` via `positiveAmount`; **absent** at `app/api/deposits/route.ts:188-198` and `app/api/transactions/route.ts:172-175`
- **Evidence:**
```ts
// app/api/deposits/route.ts:188-198 — no ceiling
const amount = parseFloat(String(body.amount));
if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
  throw new ValidationError('Invalid amount format');
}
```
- **Impact:** the regex is applied to `amount.toString()` — the *re-parsed float*, not the raw input — so it validates the wrong string, and no maximum is enforced. **Arithmetic:** the DB columns are `decimal(15,2)`, whose maximum is `9,999,999,999,999.99`. A deposit of `9,999,999,999,999.99` is accepted by this route and committed; `10,000,000,000,000.00` overflows and raises Postgres error 22003 mid-transaction. The reference path caps at `MAX_AMOUNT = 10_000_000.00` (100× smaller) via `parsePositiveAmount`. A single request can therefore write a number 1000× larger than the reference permits, with no audit trail of a limit being crossed. Scientific notation also slips past: `parseFloat("1e5")` → `100000` → `"100000"` matches the regex, so the stored row no longer matches the input the user typed.
- **Fix:** route every amount through `parsePositiveAmount(String(body.amount))` and write `fromCents(cents)`; add a schema-level ceiling aligned to the product's largest plausible transaction, well below `numeric(15,2)`.

### [FIN-019] `PUT /api/funds/[id]` is unscoped, `POST /api/funds` writes an orphaned fund, and the Next route skips the Zod schema — Severity: High
- **Locations:** `server/src/modules/funds/service.ts:141-180` (update), `:90-120` (create), `app/api/funds/[id]/route.ts:8`, `server/src/modules/members/handlers.ts:97`
- **Evidence:**
```ts
// funds/service.ts:159 (update) — no tenant predicate
const [updated] = await db.update(funds).set(updateFields).where(eq(funds.id, id)).returning();

// funds/service.ts:102-115 (create) — no tenantId in the insert, though `user` is in scope
const [fund] = await db.insert(funds).values({ name, type, currency, accountNumber, description, balance: formatted, status: 'ACTIVE', isSystemAsset: false, handlingOfficer: user.name }).returning();
const [openingTxn] = await db.insert(transactions).values({ type: 'Deposit', amount: formatted, description: 'Opening balance', fundId: fund.id, date: new Date(), status: 'Completed', ... }).returning();
```
```ts
// app/api/funds/[id]/route.ts:8 → members/handlers.ts:97 — raw body, validation.ts bypassed
return handleUpdateFund(request, id);
const fund = await fundsService.updateFund(id, body as never);
```
```ts
// funds/routes.ts:17 — the Express router DOES validate; the Next route does not
.put(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(updateFundSchema), updateFund);
```
- **Impact:** (a) `updateFund` matches on `funds.id` alone, so a `FUNDS_MANAGEMENT:WRITE` holder in tenant A can rename, re-`type`, re-`status` (including flipping a fund to `CLOSED`/`FROZEN`, which gates deposits and expenses) and reassign `linkedProjectId`/`handlingOfficer` for a fund belonging to tenant B — and re-`type`ing a fund as `PROJECT` silently changes which expenses route to it. (b) `createFund` accepts a `user` argument and still never sets `tenant_id`; the new fund and its opening-balance transaction are both written with `NULL` (columns are nullable, `db/schema/funds.ts:6`) and are therefore invisible to every tenant-scoped query — **Arithmetic:** a treasurer creates a `PROJECT` fund with `initialBalance: 1,000,000.00`. The `1,000,000.00` is committed to `funds.balance` and to a `'Completed'` transaction, and the fund is then unlistable, unapprovable, and unreconcilable by anyone; every expense routed to it will 404. (c) `updateFund` does whitelist its fields so `balance` cannot be written directly — good — but the Next route passes the unvalidated body, so `status` and `type` accept arbitrary strings with no enum check.
- **Fix:** add `eq(funds.tenantId, tenantId)` to every funds read/update; set `tenantId` in `createFund`; call `updateFundSchema.parse(body)` (or `fundService.updateFund` from a handler that validates) in the Next route rather than casting to `never`; make `funds.tenant_id` `NOT NULL`.

### [FIN-020] A member can edit a completed deposit, and the revert silently destroys equity via `GREATEST(0, …)` — Severity: Medium
- **Location:** `server/src/modules/finance/service.ts:480-608` (`editDeposit`), revert at `:548-563`
- **Evidence:**
```ts
// line 548-563 — reverting a Completed deposit clamps instead of erroring
await tx.update(members)
  .set({
    totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${oldAmountCents/100})::numeric(15,2)`,
    updatedAt: new Date(),
  })
  .where(eq(members.id, oldMemberId));
```
- **Impact:** the clamp converts a business-rule violation into silent data loss. If the member's `totalContributed` is already lower than the deposit being reverted — because of a penalty deduction (FIN-005), a withdrawal, or the recompute bug in FIN-006 — the subtraction floors at `0.00` and the member's entire equity is erased with no error and no audit record. **Arithmetic:** the member's `totalContributed` is `1,000.00` (a `500.00` deposit, of which a penalty already removed most). Reverting the `500.00` deposit writes `GREATEST(0, 1000.00 − 500.00) = 500.00` while the *deposit row* becomes `PENDING` again; reverting a `2,000.00` deposit when the member only has `1,000.00` writes `0.00` and the member loses everything. The endpoint also lets the caller switch `fundId` on an already-`Completed` deposit with **no** sufficiency check on the new fund, so a completed deposit can be re-pointed at a fund holding `0.00` and drive it negative.
- **Fix:** throw a `ValidationError` when the member's `totalContributed` is insufficient to revert, instead of clamping; require the new fund to have sufficient balance when `fundId` changes on a completed deposit; never allow `Completed → PENDING` transitions on deposits older than the current period (see FIN-014).
- **Needs verification:** whether a non-privileged member can reach this. `handlers.ts:47` calls `requireDepositWritePermission(body.status)`, and the service permits the owner to edit their own deposit. Confirm by reading `requireDepositWritePermission` in `server/src/middleware/api.ts` and `hasScreenPermission` in `lib/permissions.ts`: if a plain `Member` can hold `DEPOSITS:WRITE` for `status='Completed'`, a member can self-approve.

### [FIN-021] Project-linked dividends debit the project but not its fund, permanently breaking the fund == project invariant — Severity: Medium
- **Location:** `server/src/modules/finance/service.ts:1386-1396`; invariant asserted at `:1604-1612`
- **Evidence:**
```ts
// line 1386-1396 — only the project is debited
await tx.update(projects)
  .set({ currentFundBalance: sql<string>`GREATEST(0, (${projects.currentFundBalance}::numeric - ${totalDisbursedCents/100})::numeric(15,2))`, updatedAt: new Date() })
  .where(eq(projects.id, data.projectId));
```
- **Impact:** `reconcileFund` treats `fund.balance` and `project.currentFundBalance` as two independent records of the same money and reports `projectMismatch` when they differ (`service.ts:1604-1612`, and `app/api/funds/[id]/route.ts` surfaces it). `addExpense` (`:752-763`) and `addEarning` (`:812-823`) both debit/credit **both** sides, keeping the invariant. A `Project`-type dividend breaks it: **Arithmetic** project-linked fund at `500,000.00` with `project.currentFundBalance = 500,000.00`; a `100,000.00` dividend run of type `Project` leaves `fund.balance = 500,000.00` but `project.currentFundBalance = 400,000.00`, and since dividend rows for `type='Project'` are inserted with `fundId: null` (`service.ts:1414-1417`) no ledger row can ever reconcile the difference. Every subsequent reconciliation for that fund reports `DISCREPANCY`, and the report is not actionable.
- **Fix:** for `type = 'Project'`, debit the linked fund (`projects.linkedFundId`) inside the same transaction and attach the transaction rows to that fund, so both ledgers move together; or explicitly document the project balance as an independent pool and stop comparing it in `reconcileFund`.

### [FIN-022] Penalty deductions move equity with no ledger entry and no fund credit — Severity: Medium
- **Location:** `app/api/governance/penalties/route.ts:148-205`
- **Evidence:**
```ts
// line 148-154 — client-controlled nominal, no Zod, no ceiling
if (penaltyType === 'FUND_DEDUCTION' || (penaltyType === 'SUSPENSION' && nominalDeduction > 0)) {
  const memberContributed = Number(member.totalContributed ?? 0);
  if (penaltyIsPercentage) {
    calculatedDeduction = Math.round(memberContributed * (nominalDeduction / 100) * 100) / 100;
  } else { calculatedDeduction = nominalDeduction; }
...
// line 170 — the only money write: a clamped debit on the member
totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${calculatedDeduction}))::numeric(15,2)`,
```
- **Impact:** (a) No `transactions` row is inserted and `targetFundId` is only *recorded* on the penalty (`:199`) — it is never credited. The cash stays in the fund while the member's equity is reduced, so the club's books show `fund.balance` unchanged and member equity down by the fine. `verify-complete-math.ts` has no way to see it, and `reconcileFund` is unaffected, so this deduction is invisible to every money control. (b) `nominalDeduction` and `isPercentage` come straight from the request body with no Zod schema and no ceiling; any non-`Member` role can issue a `100%` deduction of a member's entire contribution. (c) The recorded `calculatedDeduction` (`:198`) is the pre-clamp figure, so the penalty row disagrees with the money actually taken — the root of FIN-005. (d) `isPercentage` on a `SUSPENSION` tier is accepted (`:148`), so a suspension silently also confiscates money. (e) The penalty insert omits `tenantId` (see FIN-010).
- **Fix:** insert a `type='Expense'` transaction with `category='Governance Fine'` and credit `targetFundId` inside the same transaction, so the fine is visible to reconciliation; validate `deductionAmount` and `isPercentage` with Zod and cap a percentage fine at a policy maximum; store the effective (post-clamp) deduction.

### [FIN-023] `system_settings` is read with `.limit(1)` and no tenant filter in four money paths — Severity: Medium
- **Locations:** `app/api/dividends/calculate/route.ts:51`; `app/api/dividends/distribute/route.ts:66`; `app/api/funds/transfer/route.ts:107`; `app/api/governance/penalties/route.ts:130`
- **Evidence:**
```ts
// app/api/dividends/distribute/route.ts:66
const [settings] = await db.select().from(systemSettings).limit(1);
const statutoryReservePercent = parseFloat(String((settings as Record<string, unknown>)?.statutoryReservePercent ?? 0));
```
- **Impact:** `system_settings` is per-tenant (`db/schema/system_settings.ts`: `tenantId` plus `unique('uq_system_settings_tenant')`). An unscoped `.limit(1)` returns an arbitrary tenant's row, so a club's dividend run can be governed by another club's statutory reserve rate, share value, or withdrawal limit. **Arithmetic:** tenant A configures `statutoryReservePercent = 10`; tenant B has `0`. `POST /api/dividends/distribute` for tenant A picks B's row at random (`ORDER BY` is undefined without `ORDER BY`) and applies a `0%` reserve, distributing `100,000.00` gross entirely to members when the constitution requires `10,000.00` to be retained. The `parseFloat` then feeds FIN-008's float rounding. Same class in the transfer path (share value) and the penalty path (penalty rules).
- **Fix:** `db.select().from(systemSettings).where(eq(systemSettings.tenantId, tenantId))` everywhere, and fail closed if the row is missing.

### [FIN-024] Nothing enforces `shares × shareValue == contributed` at runtime; the share helpers are dead code — Severity: Medium
- **Locations:** `lib/shares.ts`; consumers: `server/src/modules/finance/service.ts:28` (`assertIntegralShares` only); report: `server/src/modules/finance/share-consistency.ts:33-38`
- **Evidence:**
```ts
// server/src/modules/finance/share-consistency.ts:33-38 — float division, and unreachable from app/api
const shareValue = Number(settings.shareValueBdt) || 1000;
const expected = Math.floor(Number(m.totalContributed) / shareValue);
```
```ts
// lib/shares.ts — resolveShareValueCents, sharesToCents, sharesFromCents, proRataCents
// are referenced ONLY by lib/shares.test.ts; no production module imports them.
```
- **Impact:** the exact integer helpers for the core invariant exist, are correct, are fully tested, and are unused. Meanwhile the only implementation of the invariant uses `Number()` division with a float share value, and it is reachable only through the Express router (`server/src/modules/finance/routes.ts:78`), which is not mounted by Next — so **no request path ever verifies the share/equity invariant**. `shareValueBdt` is also settable with no validation (`app/api/settings/route.ts:235`, `String(data.financial.shareValueBdt)`) — `"-500"` and `"abc"` are accepted whenever `isShareValueLocked` is false.
- **Fix:** expose `GET /api/finance/share-consistency` wired to `getShareConsistencyReport` but reimplemented with `sharesFromCents`/`sharesToCents`; validate `shareValueBdt` with `resolveShareValueCents` in `app/api/settings/route.ts`; and make the report a scheduled job whose failure blocks period close.

### [FIN-025] The member share lock is bypassable by soft-deleting the transaction that set it — Severity: Medium
- **Location:** `app/api/members/[id]/route.ts:145-156`
- **Evidence:**
```ts
if (body.shares !== undefined) {
  const [txnCount] = await db.select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.memberId, existing.id), eq(transactions.isDeleted, false)));
  if ((txnCount?.total ?? 0) > 0) {
    throw new LockedError('Share numbers are locked once transactions exist');
  }
```
- **Impact:** the guard counts only non-deleted transactions, and `DELETE /api/transactions/[id]` (`app/api/transactions/[id]/route.ts:109-119`) soft-deletes them without any permission beyond authentication (FIN-013) and without reversing money (FIN-003). **Arithmetic:** a member has `1,000,000.00` of completed deposits; an admin soft-deletes those rows (fund balance still `1,000,000.00`, member equity unchanged) and then PATCHes `shares: 20` → the guard passes. The member now owns 20 shares of a `1,000.00` share value (`20,000.00` of nominal capital) against `1,000,000.00` of actual contributions, and their dividend entitlement is off by 50×. Two existing safeguards are also weaker than they look: the count includes `PENDING` deposit *requests*, so a member who merely asked to pay is permanently locked out of a share correction, and the count is not inside a transaction with the update (`:163-167`), so two concurrent PATCHes can both observe `0` transactions.
- **Fix:** count only money-bearing non-deleted rows **and** never allow a soft delete of a money-bearing row without a reversal (FIN-003); perform the count and the update in one transaction with the member row locked; make the lock permanent once any completed transaction ever existed (`everHadTransactions` flag or an immutable `shares_locked_at`).

### [FIN-026] `addExpense` / `editExpense` accept an unvalidated, unbounded date and bypass all period rules — Severity: Medium
- **Location:** `server/src/modules/finance/service.ts:784`, `:820-834`
- **Evidence:**
```ts
// line 784
date: data.date ? new Date(data.date) : new Date(),
```
- **Impact:** `data.date` is an arbitrary string from the request body. `"not-a-date"` produces `new Date(NaN)` → Postgres `22007 invalid input syntax for type timestamp` → the whole transaction rolls back with a 500 (availability, not corruption, but it is an unvalidated field on a money write). More importantly there is no upper or lower bound, so an expense can be dated years in the past or in the future, breaking every period-scoped total — `fiscal_periods.totalExpenses` is only written by the dividend run (`app/api/dividends/distribute/route.ts:293`), so **Arithmetic:** expenses of `50,000.00` in Q4 plus a `25,000.00` expense dated `2026-01-01` both land in a 2025 fiscal year; the fiscal-year report shows `75,000.00` of expenses while the period close for 2025 has no idea the second row exists.
- **Fix:** Zod-validate `date` as ISO-8601, clamp it to `[now − 90d, now]` for non-admin roles, and run the `assertPeriodOpen` guard from FIN-014.

### [FIN-027] `ratePerShare` is reported in two different units for the same row — Severity: Low
- **Location:** `app/api/dividends/distribute/route.ts:213` (reported) vs `:279` (stored)
- **Evidence:**
```ts
// line 213 — cents per share
const ratePerShare = totalActiveShares > 0 ? (netDistributableCents / totalActiveShares).toFixed(4) : '0.0000';
// line 279 — currency units per share
ratePerShare: (payoutCents / (memberShares * 100)).toFixed(6),
```
- **Impact:** the API's top-level `ratePerShare` and the `profit_allocations.ratePerShare` for the identical dividend differ by 100×: for a `90,000.00` distribution over `300` shares the summary reports `300.0000` (cents) while the stored row is `3.000000` (currency). A client rendering `profit_allocations.ratePerShare` against `summary.ratePerShare` mis-scales every rate by 100. The `ratePerShare` in the response is also built from a float division of the total, and the column is `decimal(15,6)` (`db/schema/profit_allocations.ts:15`) so the stored value is rounded again to 6dp.
- **Fix:** store and return one unit (currency per share, 6dp), computed as `payoutCents / (memberShares * 100)` and rounded with `toFixed(6)`; rename the summary field to `ratePerShareCents` if cents are required.

### [FIN-028] Deposit rejection mutates a string field outside a transaction with no lock — Severity: Low
- **Location:** `app/api/deposits/[id]/reject/route.ts:81-89`
- **Evidence:**
```ts
await db
  .update(transactions)
  .set({ status: 'REJECTED', description: `${deposit.description} - REJECTED: ${reason || 'No reason given'}`, updatedAt: new Date() })
  .where(eq(transactions.id, id));
```
- **Impact:** `deposit.description` was read before this write and is concatenated into the new value, so two concurrent rejects of the same deposit interleave into garbage (`"Deposit A - REJECTED: x - REJECTED: y"`, or a lost suffix). The `status = 'PENDING'` guard is likewise checked pre-transaction, so a reject racing an approve can win or lose non-deterministically — and if the reject wins after an approval already credited the fund, the money stays credited with no compensating entry. No rejection audit row is written.
- **Fix:** do the read, the guard and the write in one transaction with `for('update')` on the deposit; append to `description` in SQL or store rejection in its own column; write an audit entry; block rejection once the deposit is `Completed`.

### [FIN-029] Rejections and soft deletes are reachable by anyone who can read the ledger — Severity: Low
- **Location:** `app/api/deposits/[id]/reject/route.ts:24-40`; `app/api/governance/penalties/route.ts:106-108`
- **Evidence:**
```ts
// reject/route.ts — the only role check
if (normalizeRole(user.role) === 'Member') {
  throw new ForbiddenError('Insufficient permission to reject deposits');
}
```
- **Impact:** role-name checks rather than screen-permission checks. In this codebase `normalizeRole(user.role) === 'Member'` is the only bar on rejecting a deposit, so any non-`Member` role (including `Secretary` or `Volunteer` if such roles exist, or any newly added role) can reject a member's deposit. The penalties endpoint uses the same `!== 'Member'` shape (`:106-108`) to gate issuing deductions, which is a money action. This is a fail-open default for new roles.
- **Fix:** use the same `hasScreenPermission(user, 'DEPOSITS', 'WRITE')` / `'GOVERNANCE', 'WRITE'` model the rest of the finance module uses, and add the segregation-of-duties rule that the approver of a deposit may not be its requester.

### [FIN-030] `parsePositiveAmount` accepts a JS number for a money field — Severity: Low
- **Location:** `lib/money.ts` `toCents` / `parsePositiveAmount`
- **Evidence:** `toCents` accepts `number` and computes `Math.round(value * 100)`, then rejects if the original had more than 2dp. The precision check is what makes this safe, and it is correct (`0.07 * 100 = 7.000000000000001`, within the `1e-6` tolerance). Noted only because `lib/money.test.ts` never covers the numeric branch end-to-end through `parsePositiveAmount` beyond `0.01`, and callers such as `app/api/dividends/distribute/route.ts:101` (`perMemberCents / member.shares`) pass floats into integer helpers by design.
- **Impact:** none demonstrated; `1e-6` cents of tolerance is safely below one cent. Included so the audit does not imply float money is safe here — it is, and the *callers* who bypass it (FIN-008, FIN-018, FIN-022) are the actual problem.
- **Fix:** none required; optionally narrow the public signature to `string` and make callers convert once.

## Drift vs legacy reference (`server/src`)

| # | Behaviour | Next.js / `app/api` path | `server/src` reference | Consequence |
|---|---|---|---|---|
| D1 | Approving a deposit | `app/api/deposits/[id]/approve`: status guard + fund read **outside** the tx, no row lock (`:42`, `:59`) | `service.ts:633-637`: `.for('update')` + status recheck **inside** the tx | FIN-002 — a regression: double approval is now possible |
| D2 | Fund balance update after a dividend run | `app/api/dividends/distribute:184-188`: `parseFloat` + `toFixed` | `service.ts:1408-1411`: same JS-literal write | Both are unlocked; the Next path is additionally float-based (FIN-007, FIN-008) |
| D3 | Dividend → member `totalContributed` | `app/api/dividends/distribute:250-258`: **credits** each member's `totalContributed` | `service.ts:1336-1442`: only writes `'Dividend'` transactions, **never** credits `totalContributed` | The two dividend paths are mutually inconsistent; whichever is used changes every member's equity and future dividend entitlement. `verify-complete-math.ts` sides with the reference (its invariant excludes dividends) |
| D4 | Profit allocation rounding | `splitDividendByShares` (largest remainder, exact) | `fiscal/profit-allocation.ts:71`: `Math.floor(memberShares * ratePerShare * 100)/100` per member, remainder silently `retained` | **The Next implementation is better.** The reference loses up to `(n−1)` cents per run with no `totalDistributed` cross-check. `executeProfitAllocation` is currently unreachable from `app/api` (no `app/api/fiscal/**` route) — see FIN-016's sibling note below |
| D5 | Reconciliation type→direction map | `app/api/transactions:70-84` vs `service.ts:352-353` vs `service.ts:1604-1608` | `verify-complete-math.ts:118-125` (a third, different map) | FIN-015 — four maps, one direction disagreement (`Investment`) and four live types in none of them |
| D6 | Equity transfer ledger rows | `service.ts:1506-1517` writes legs with **no `tenant_id`** | same code (this *is* the reference — there is no non-legacy version) | FIN-010 — the ledger has a single, tenant-blind writer |
| D7 | Fund transfer transaction types | `app/api/funds/transfer:104-118` → `'Transfer Out'`/`'Transfer In'` | `service.ts#transferFunds` → `'Withdrawal'`/`'Investment'`, both of which the reporting lists already know | FIN-015 — `Withdrawal` is counted, `Transfer Out` is not, so the same operation reports differently depending on which endpoint was used |
| D8 | Fund creation | `funds/service.ts:102-115`: no `tenant_id` | no legacy alternative | FIN-019 |
| D9 | Deposit amount ceiling | `app/api/deposits`: none | `validation.ts` `positiveAmount` → `parsePositiveAmount` → `MAX_AMOUNT = 10_000_000` | FIN-018 — 1000× gap |
| D10 | Share/equity consistency check | not exposed in Next at all | `routes.ts:78` `GET /finance/share-consistency` (Express only) | FIN-024 — the only invariant checker is unreachable |
| D11 | Withdrawal rules | `withdrawal-rules.ts` (11.6 KB: notice days, limits, pro-rata caps) imported by `controller.ts:9` but routed only through the unmounted Express router | — | The withdrawal-limit policy is implemented and unreachable; `systemSettings.withdrawalLimitPercent`, `withdrawalNoticeDays` and `maxWithdrawalPerRequest` are settable (`app/api/settings/route.ts:240-248`) and enforce nothing |

## Money invariants that need tests

`lib/money.test.ts` and `lib/shares.test.ts` are strong — 69 passing tests including a 200-run randomized `splitDividendByShares` conservation check, largest-remainder determinism, 2dp-rejection, and `sharesFromCents` flooring. Everything below is untested:

1. **Conservation of the largest-remainder split under adversarial shapes** — zero-share members mixed with active, a single member holding all shares, `residual ≥ n`, and `totalCents` not divisible by the gcd of the share set. (`splitDividendByShares` sorts by fractional remainder, then by `id` string; the wrap-around `order[k % order.length]` is exercised only incidentally.)
2. **Concurrency / lost update** on `funds.balance` and `members.totalContributed` for `POST /api/deposits` (FIN-001), `PUT /api/deposits/[id]/approve` (FIN-002), `POST /api/funds/transfer` (FIN-004), `POST /api/finance/dividends` (FIN-007), `POST /api/governance/penalties/[id]/waive` (FIN-005). Needs a real Postgres with two concurrent clients asserting the final balance, not mocks.
3. **Double-submit / idempotency** for every money POST: assert the second identical request is a no-op with the same response, and that the fund balance and member equity are unchanged.
4. **Rollback on partial failure** — inject a failure at each write inside the multi-step transactions (deposit approval, dividend distribution, equity transfer, reconciliation) and assert *zero* rows persisted in every table. Nothing tests this today.
5. **`sum(allocations) == gross − reserve` and `sum(member dividends) == netDistributable`** as an assertion inside the distribution transaction (not just inside the pure helper).
6. **Statutory reserve** for a table of `(gross, percent)` pairs including `0.05/50`, `0.15/50`, `0.30/10`, and `0/0`, asserting half-up-to-the-cent and never exceeding gross (FIN-008).
7. **Penalty waive round-trip**: `contributed − effectiveDeduction + effectiveDeduction == contributed`, and `effectiveDeduction == GREATEST(0, contributed − nominal)` (FIN-005, FIN-022).
8. **Equity-transfer conservation**: `Σ before == Σ after` across both members, and that both ledger rows carry the caller's `tenant_id` (FIN-010).
9. **Negative / zero / `NaN` / `Infinity` / scientific-notation / 3dp amounts** on *every* money endpoint. The reference has `parsePositiveAmount` tests; the Next paths (`app/api/deposits`, `app/api/transactions`, `app/api/governance/penalties`) have none and would each accept or crash differently.
10. **Tenant isolation on every money row**: a property test asserting no row in `transactions`, `funds`, `profit_allocations` or `member_penalties` has `tenant_id IS NULL`, plus a cross-tenant access test for `app/api/transactions/[id]`, `funds/service.ts#updateFund` and the waiver route.
11. **Reconciliation closure**: after a scripted month (deposit, expense, fund transfer, dividend with reserve, penalty, equity transfer), `reconcileFund` must report `MATCHED` for every fund (FIN-015, FIN-021, FIN-022).
12. **`deleteTransaction` recompute** must preserve dividend and equity-transfer credits (FIN-006) — the invariant `totalContributed == Σ(contribution-affecting transactions)` deserves a direct test.

## What is done right (short)

- `lib/money.ts` is genuinely excellent: integer minor units throughout, `toCents` rejects >2dp input instead of silently rounding, `roundToCents` is half-away-from-zero, `splitDividendByShares` is largest-remainder with deterministic tie-breaking and exact conservation, and the 200-run randomized test proves the property. It should be the only money path.
- `db/schema` money representation is right: every money column is `decimal(15,2)`, `members.shares` and `projects.totalShares` are `integer`, and `profit_allocations.ratePerShare` is `decimal(15,6)`. No `float`/`real` money columns.
- The reference implementation's happy path is properly transactional with row locks and idempotent status re-checks: `approveDeposit` uses `for('update')` on the deposit, the member and the fund, re-checks the status inside the transaction, and computes the fund update in SQL (`service.ts:633-666`); the same pattern holds in `bulkAddDeposits` (`service.ts:800-830`) and `editDeposit`.
- Most balance mutations use atomic SQL arithmetic (`sql\`${funds.balance}::numeric + ...\``) rather than read-modify-write, and the `LOCKED_ROWS` map shows the author was deliberately thinking about lock ordering.
- `funds/service.ts:141-180` whitelists the fields an update may touch, so a fund `balance` cannot be set directly through the API.
- Authorization is consistently fail-closed on tenant context in most of the surface (`app/api/deposits/route.ts:34-40` throws rather than degrading), and the finance module routes through `requirePermission('FINANCE', …)` / `requirePermission('DEPOSITS', …)` rather than ad-hoc role strings.
- `app/api/dividends/calculate` is read-only, correctly uses `splitDividendByShares`, and correctly excludes non-`active` members from the entitlement base.
