import { sql, type SQL } from 'drizzle-orm';
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
