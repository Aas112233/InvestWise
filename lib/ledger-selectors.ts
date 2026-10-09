import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { transactions } from '@/db/schema/index';

/**
 * One shared definition of "money the fund actually holds".
 *
 * Before this module every aggregate re-derived its own predicate and they
 * disagreed with each other and with the ledger — the QA report found the
 * Deposits page, Dashboard, Analysis and Transactions KPIs each showing a
 * different "total deposits" for the same data (issues 27 / 34 / 47):
 *
 *   - none of the four filtered by `status`, so a PENDING request or a
 *     REJECTED slip was counted as collected cash;
 *   - the Transactions KPIs also counted `Transfer In` / `Transfer Out`, so an
 *     internal fund-to-fund movement inflated both inflow and outflow by the
 *     same amount (it cancelled in "net", which hid the error).
 *
 * The member directory already had the right predicate
 * (`status IN ('Completed','Success')`); this module is that predicate lifted
 * into one place so the four call sites cannot drift again (§12).
 */

/** Statuses that mean money has genuinely landed. */
export const SETTLED_DEPOSIT_STATUSES = ['Completed', 'Success'] as const;

/**
 * Movement types that represent the fund's own money moving between its own
 * pockets. They are real ledger entries but NOT member contributions and NOT
 * operating income/expense, so they must never appear in a "collected" or
 * "inflow/outflow" headline.
 */
export const INTERNAL_TRANSFER_TYPES = ['Transfer', 'Transfer In', 'Transfer Out'] as const;

/**
 * A settled deposit for one tenant: completed/successful, not soft-deleted,
 * and not an internal transfer. Spread into a `where(and(...))` alongside the
 * caller's own tenant/fund/member predicates.
 *
 * `tenantId` is required and unconditional — the aggregates that use this are
 * reachable from `app/api` and a null tenant must never widen the read (§6).
 */
export function settledDepositConditions(tenantId: string): SQL[] {
  return [
    eq(transactions.tenantId, tenantId),
    eq(transactions.isDeleted, false),
    eq(transactions.type, 'Deposit'),
    inArray(transactions.status, [...SETTLED_DEPOSIT_STATUSES]),
    sql`${transactions.type} <> ALL(${sql.raw(
      `ARRAY[${INTERNAL_TRANSFER_TYPES.map((t) => `'${t}'`).join(',')}]::text[]`,
    )})`,
  ];
}

/**
 * Same idea as `settledDepositConditions` but as a single SQL fragment, for
 * the query builders that assemble a raw `sql` predicate list rather than
 * drizzle column conditions (e.g. the transactions ledger endpoint).
 */
export function settledDepositSql(tenantId: string): SQL {
  return sql`(
    ${transactions.tenantId} = ${tenantId}
    AND ${transactions.isDeleted} = false
    AND ${transactions.type} = 'Deposit'
    AND ${transactions.status} IN ('Completed', 'Success')
  )`;
}

/**
 * Predicate for "counts as money arriving in the fund" in a flow KPI. Includes
 * real income types (Earning) but excludes internal transfers and unsettled
 * deposits.
 */
export function inflowSqlPredicate(): SQL {
  return sql`(
    (${transactions.type} = 'Deposit' AND ${transactions.status} IN ('Completed', 'Success'))
    OR ${transactions.type} = 'Earning'
    OR ${transactions.type} = 'Investment'
  )`;
}

/** Predicate for "counts as money leaving the fund" in a flow KPI. */
export function outflowSqlPredicate(): SQL {
  return sql`(
    ${transactions.type} = 'Expense'
    OR ${transactions.type} = 'Disbursement'
    OR (${transactions.type} = 'Dividend' AND ${transactions.status} IN ('Completed', 'Success'))
    OR ${transactions.type} = 'Withdrawal'
  )`;
}
