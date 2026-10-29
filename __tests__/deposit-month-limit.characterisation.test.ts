/**
 * Phase 0 CHARACTERISATION LOCK — the one-deposit-per-member-per-month predicate.
 *
 * `lib/deposit-month-limit.ts` is the SINGLE owner of the monthly duplicate rule and is
 * enforced on 8 write paths. Phase 2 threads a flexible "not enforced" branch through it, so
 * this file pins the MONTHLY predicate as DRIZZLE-RENDERED SQL text. If a later edit changes
 * the predicate a monthly tenant runs, this fails with the exact before/after visible.
 *
 * Rendered SQL (not source strings) is deliberate: a swapped column, dropped clause or altered
 * status vocabulary fails here, where a comment or refactor edit would not trip a text grep.
 * Golden strings were captured from the real builder and verified clause-by-clause against
 * lib/deposit-month-limit.ts:97-147 before being locked. See docs/DEPOSIT_SCHEDULE_DESIGN.md §9.
 */

import { describe, expect, it } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { transactions } from '@/db/schema/index';
import {
  DEPOSIT_PERIOD_PROGRESS_FIELDS,
  depositMonthConflictMessage,
  depositMonthOccupiedBatchCondition,
  depositMonthOccupiedCondition,
  depositMonthsOccupiedCondition,
  depositPeriodProgressCondition,
  findDepositMonthOccupant,
  findDepositMonthOccupants,
  findDepositMonthOccupancyInRange,
  findDepositPeriodProgressInRange,
} from '@/lib/deposit-month-limit';

const qb = new QueryBuilder();

/** Render a condition exactly as a finder runs it. No session needed for `toSQL()`. */
function render(cond: ReturnType<typeof depositMonthOccupiedCondition>) {
  const q = qb.select({ id: transactions.id }).from(transactions).where(cond).toSQL();
  return { sql: q.sql, params: q.params as unknown[] };
}

const TENANT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const PREFIX = 'select "id" from "transactions" where ("transactions"."tenant_id" = $1';
/** The month a deposit is FOR — same expression GET /api/deposits?depositMonth= filters on. */
const MONTH = `COALESCE("transactions"."deposit_month", to_char("transactions"."date" AT TIME ZONE 'UTC', 'YYYY-MM'))`;
/**
 * Settled money OR a pending REQUEST occupies the month; a reverted DIRECT deposit
 * (category 'Deposit' + pending) freed its month and must not block revert → re-approve.
 * NOTE: written as a raw `sql` template, so this vocabulary is INLINE TEXT, not bind
 * parameters — it can only be guarded by exact text, which is why this file exists.
 */
const OCCUPYING = `("transactions"."status" IN ('Completed', 'Success') OR (lower(COALESCE("transactions"."status", '')) = 'pending' AND COALESCE("transactions"."category", '') <> 'Deposit'))`;

describe('monthly month-occupancy predicate (golden rendered SQL)', () => {
  it('single month — exact statement and bind order', () => {
    const { sql, params } = render(
      depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' }),
    );
    expect(sql).toBe(
      `${PREFIX} and "transactions"."member_id" = $2 and "transactions"."type" = $3`
      + ` and "transactions"."is_deleted" = $4 and ${MONTH} = $5 and ${OCCUPYING})`,
    );
    expect(params).toEqual([TENANT, MEMBER, 'Deposit', false, '2026-10']);
  });

  it('tenant + member + type + not-deleted are always bound, never interpolated', () => {
    const { params } = render(
      depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' }),
    );
    expect(params.slice(0, 4)).toEqual([TENANT, MEMBER, 'Deposit', false]);
    // §6 tenant scope and §12 soft-delete are both load-bearing.
    expect(render(depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' })).sql)
      .toContain('"transactions"."is_deleted" = $4');
  });

  it('excludeId appends one inequality and one trailing bind (re-approval after revert)', () => {
    const { sql, params } = render(
      depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10', excludeId: OTHER }),
    );
    expect(sql).toBe(
      `${PREFIX} and "transactions"."member_id" = $2 and "transactions"."type" = $3`
      + ` and "transactions"."is_deleted" = $4 and ${MONTH} = $5 and ${OCCUPYING}`
      + ` and "transactions"."id" <> $6)`,
    );
    expect(params).toEqual([TENANT, MEMBER, 'Deposit', false, '2026-10', OTHER]);
  });

  it('batch variant widens member_id to an IN list; positional binds shift accordingly', () => {
    const { sql, params } = render(
      depositMonthOccupiedBatchCondition({ tenantId: TENANT, memberIds: [MEMBER, OTHER], depositMonthKey: '2026-10' }),
    );
    expect(sql).toBe(
      `select "id" from "transactions" where ("transactions"."tenant_id" = $1`
      + ` and "transactions"."member_id" in ($2, $3) and "transactions"."type" = $4`
      + ` and "transactions"."is_deleted" = $5 and ${MONTH} = $6 and ${OCCUPYING})`,
    );
    expect(params).toEqual([TENANT, MEMBER, OTHER, 'Deposit', false, '2026-10']);
  });

  it('multi-month variant ORs parameterised equalities so the predicate stays indexable', () => {
    const { sql, params } = render(
      depositMonthsOccupiedCondition({
        tenantId: TENANT, memberId: MEMBER, depositMonthKeys: ['2026-07', '2026-08'],
      })!,
    );
    expect(sql).toBe(
      `${PREFIX} and "transactions"."member_id" = $2 and "transactions"."type" = $3`
      + ` and "transactions"."is_deleted" = $4 and ${OCCUPYING}`
      + ` and (${MONTH} = $5 or ${MONTH} = $6))`,
    );
    expect(params).toEqual([TENANT, MEMBER, 'Deposit', false, '2026-07', '2026-08']);
  });

  it('an empty month set is NO CONDITION — callers must treat null as "nothing to check"', () => {
    expect(depositMonthsOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKeys: [] })).toBeNull();
  });

  it('the occupancy vocabulary is inline text, so a silent edit to it is a behavioural change', () => {
    const { sql } = render(
      depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' }),
    );
    // Settled money.
    expect(sql).toContain(`"transactions"."status" IN ('Completed', 'Success')`);
    // Pending, case-insensitive: routes write 'PENDING', the finance Zod enum allows 'Pending'.
    expect(sql).toContain(`lower(COALESCE("transactions"."status", '')) = 'pending'`);
    // The reverted-direct-deposit carve-out that makes revert → re-approve work.
    expect(sql).toContain(`COALESCE("transactions"."category", '') <> 'Deposit'`);
  });

  it('CURRENT BEHAVIOUR, NOT ENDORSED — the write-path month key is UTC, not tenant-local', () => {
    // GET /api/deposits?depositMonth= filters using the TENANT timezone
    // (app/api/deposits/route.ts:134) while this predicate hardcodes 'UTC'. A deposit recorded
    // near a month boundary can therefore read as one month and reserve another. Recorded, not
    // fixed here: changing it would move existing tenants' historical month attribution.
    const { sql } = render(
      depositMonthOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' }),
    );
    expect(sql).toContain(`AT TIME ZONE 'UTC'`);
  });
});

describe('monthly rejection message (golden, §11 API contract)', () => {
  it('settled deposit — names the month, the code and the way out, verbatim', () => {
    expect(depositMonthConflictMessage('2026-10', {
      id: 'tx-1', memberId: MEMBER, status: 'Completed', category: 'Deposit', referenceNumber: 'DEP-1',
    })).toBe(
      `[Field 'depositMonth', Code: DUPLICATE_MONTH] This member already has a deposit for 2026-10. `
      + `Only one deposit per member per month is allowed — Revert the recorded deposit first if this entry should replace it.`,
    );
  });

  it('pending request — routes the officer to approve/reject, not revert', () => {
    expect(depositMonthConflictMessage('2026-10', {
      id: 'tx-2', memberId: MEMBER, status: 'PENDING', category: 'Deposit Request', referenceNumber: null,
    })).toContain('Approve or reject the pending request first');
  });

  it('unknown occupant — still a well-formed §11 field error', () => {
    expect(depositMonthConflictMessage('2026-10', null)).toContain("[Field 'depositMonth', Code: DUPLICATE_MONTH]");
  });
});

/**
 * H6 — per-period PROGRESS. A separate read from the occupancy rule above, and the reason it is
 * separate is the harm: a flexible month holds several deposits and reserves none, so the
 * one-row-per-month occupancy map can neither lock it nor describe it. These tests pin that the
 * progress read describes ALL of it and is never gated by the schedule.
 */
describe('per-period progress (H6)', () => {
  const renderProgress = (keys: string[]) => {
    const condition = depositPeriodProgressCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKeys: keys });
    expect(condition).not.toBeNull();
    return qb
      .select(DEPOSIT_PERIOD_PROGRESS_FIELDS)
      .from(transactions)
      .where(condition!)
      // The month expression is private in the module; the exported SELECT field carries the very
      // same SQL object the finder groups by, so the golden tests the real statement.
      .groupBy(DEPOSIT_PERIOD_PROGRESS_FIELDS.depositMonthKey)
      .toSQL();
  };

  /**
   * The whole statement, golden. NOTE the SELECT list: drizzle renders column references inside a
   * reused raw `sql` fragment WITHOUT the table qualifier when they are selected, and WITH it in
   * WHERE/GROUP BY. That is safe here only because the query is single-table — if this read ever
   * gains a JOIN, `"deposit_month"`/`"amount"` become ambiguous and Postgres errors at runtime,
   * which is precisely why the exact text is locked rather than a `toContain`.
   */
  const PROGRESS_SQL =
    `select COALESCE("deposit_month", to_char("date" AT TIME ZONE 'UTC', 'YYYY-MM')), count(*)::int,`
    + ` coalesce(sum("amount"), 0) from "transactions" where ("transactions"."tenant_id" = $1`
    + ` and "transactions"."member_id" = $2 and "transactions"."type" = $3`
    + ` and "transactions"."is_deleted" = $4 and "transactions"."status" IN ('Completed', 'Success')`
    + ` and (${MONTH} = $5 or ${MONTH} = $6)) group by ${MONTH}`;

  it('aggregates every settled deposit of the listed periods, tenant-scoped', () => {
    const q = renderProgress(['2026-07', '2026-08']);
    expect(q.sql).toBe(PROGRESS_SQL);
    expect(q.params).toEqual([TENANT, MEMBER, 'Deposit', false, '2026-07', '2026-08']);
  });

  it('groups by the period, so one row holding four deposits reports four and not one', () => {
    // The harm H6 was written for: a per-month map that keeps one row. Counting and summing
    // happens in SQL, and there is no LIMIT to truncate the rows it counts.
    const q = renderProgress(['2026-07']);
    expect(q.sql.toLowerCase()).toContain('group by');
    expect(q.sql).toContain('count(*)::int');
    expect(q.sql.toLowerCase()).not.toContain('limit');
  });

  it('counts settled money only — a pending request is not money yet', () => {
    const sql = renderProgress(['2026-07']).sql;
    expect(sql).toContain(`"transactions"."status" IN ('Completed', 'Success')`);
    // The pending half of the occupancy vocabulary must NOT leak in: counting a PENDING request
    // would show the desk money that is not in the fund balance beside it.
    expect(sql).not.toContain("'pending'");
  });

  it('an empty period list is no condition and no query', async () => {
    expect(depositPeriodProgressCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKeys: [] })).toBeNull();
    const explosion = new Proxy({}, {
      get() { throw new Error('progress must not query for an empty period list'); },
    });
    await expect(
      findDepositPeriodProgressInRange(explosion, { tenantId: TENANT, memberId: MEMBER, depositMonthKeys: [] }),
    ).resolves.toEqual(new Map());
  });

  it('keys the map by period and keeps the total a decimal string (§8)', async () => {
    // postgres-js can hand back an aggregated count as a string; the map contract is a number.
    const rows = [
      { depositMonthKey: '2026-07', depositCount: '3', totalAmount: '4500.00' },
      { depositMonthKey: '2026-08', depositCount: 1, totalAmount: null },
    ];
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      groupBy: () => Promise.resolve(rows),
    };
    const progress = await findDepositPeriodProgressInRange(chain, {
      tenantId: TENANT, memberId: MEMBER, depositMonthKeys: ['2026-07', '2026-08'],
    });
    expect(progress.get('2026-07')).toEqual({ depositCount: 3, totalAmount: '4500.00' });
    expect(progress.get('2026-08')).toEqual({ depositCount: 1, totalAmount: '0.00' });
    expect(progress.get('2026-09')).toBeUndefined();
  });
});

/**
 * PHASE 2 EQUIVALENCE GATE — docs/DEPOSIT_SCHEDULE_DESIGN.md §9.
 *
 * The flexible branch must be ADDITIVE: a monthly tenant has to run byte-identical SQL whether
 * the `enforced` flag is omitted, defaulted, or passed explicitly true. If anything below fails,
 * monthly behaviour changed and the flexible work stops until it is fixed.
 */
describe('Phase 2 equivalence gate — monthly is unchanged, flexible is inert', () => {
  const monthlyArgs = { tenantId: TENANT, memberId: MEMBER, depositMonthKey: '2026-10' };
  const monthlySql = render(depositMonthOccupiedCondition(monthlyArgs)).sql;
  const monthlyParams = render(depositMonthOccupiedCondition(monthlyArgs)).params;

  it('omitting `enforced` renders EXACTLY the pre-flexible statement', () => {
    const { sql, params } = render(depositMonthOccupiedCondition(monthlyArgs));
    expect(sql).toBe(monthlySql);
    expect(params).toEqual(monthlyParams);
    // Belt and braces against a default-value flip.
    expect(render(depositMonthOccupiedCondition({ ...monthlyArgs, enforced: true })).sql).toBe(monthlySql);
  });

  it('`enforced: false` reserves no month for any variant', () => {
    for (const build of [
      () => depositMonthOccupiedCondition({ ...monthlyArgs, enforced: false }),
      () => depositMonthOccupiedBatchCondition({ tenantId: TENANT, memberIds: [MEMBER], depositMonthKey: '2026-10', enforced: false }),
      () => depositMonthsOccupiedCondition({ tenantId: TENANT, memberId: MEMBER, depositMonthKeys: ['2026-10', '2026-11'], enforced: false })!,
    ]) {
      const { sql, params } = render(build());
      // A constant-false predicate: no columns, no binds — it cannot match a row.
      expect(sql).not.toMatch(/tenant_id|member_id|deposit_month|status/);
      expect(params).toEqual([]);
    }
  });

  it('the finders short-circuit WITHOUT touching the database', async () => {
    // Any property access proves a query was attempted. Proving "no round trip" matters:
    // it means a flexible write cannot fail on, or be slowed by, a guard that does not
    // apply to it, and there is no path where a broken guard silently blocks the money.
    const explosion = new Proxy({}, {
      get() { throw new Error('the guard must not query the database for a flexible member'); },
    });

    await expect(findDepositMonthOccupant(explosion, { ...monthlyArgs, enforced: false })).resolves.toBeNull();
    await expect(
      findDepositMonthOccupants(explosion, { tenantId: TENANT, memberIds: [MEMBER], depositMonthKey: '2026-10', enforced: false }),
    ).resolves.toEqual([]);
    await expect(
      findDepositMonthOccupancyInRange(explosion, { tenantId: TENANT, memberId: MEMBER, depositMonthKeys: ['2026-10'], enforced: false }),
    ).resolves.toEqual(new Map());

    // Monthly still DOES query — the short-circuit must not swallow the real rule.
    await expect(findDepositMonthOccupant(explosion, monthlyArgs)).rejects.toThrow('must not query');
  });
});
