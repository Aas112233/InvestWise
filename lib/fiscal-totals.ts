import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { transactions } from '@/db/schema/index';
import type { getDb } from '@/db/index';

/**
 * Live fiscal-period totals, computed from the ledger with the SAME formula the
 * close endpoint uses (see `app/api/fiscal/periods/[id]/route.ts`).
 *
 * #52: the `fiscal_periods` summary columns are written once on close, so an
 * OPEN period advertised the all-zero snapshot it was created with — the FY
 * table disagreed with the ledger it was summarising. The GET path now calls
 * this so an open period previews exactly what closing it would record.
 *
 * Dividend-run rollups (Statutory Reserve / Dividend Distribution rows) are
 * carried forward rather than overwritten: the reserve already swept is added
 * on top, and the statutory percent applies only to the surplus no run
 * distributed.
 */
export interface FiscalPeriodTotals {
  totalDeposits: string;
  totalWithdrawals: string;
  totalEarnings: string;
  totalExpenses: string;
  netSurplus: string;
  statutoryReserve: string;
  distributableSurplus: string;
  /** Dividend-run rollups, surfaced for the close audit entry. */
  runReserve: string;
  runDistributed: string;
}

type Executor = Pick<ReturnType<typeof getDb>, 'select'>;

export async function computeFiscalPeriodTotals(
  tx: Executor,
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  reservePercent: string,
): Promise<FiscalPeriodTotals> {
  const ledgerTotals = tx
    .select({
      deposits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Deposit' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('deposits'),
      withdrawals: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Withdrawal' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('withdrawals'),
      earnings: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Earning' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('earnings'),
      expenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Expense' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('expenses'),
      runReserve: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Statutory Reserve' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('run_reserve'),
      runDistributed: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Dividend Distribution' THEN ${transactions.amount}::numeric ELSE 0::numeric END), 0)`.as('run_distributed'),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.isDeleted, false),
        eq(transactions.status, 'Completed'),
        gte(transactions.date, periodStart),
        lte(transactions.date, periodEnd),
      ),
    )
    .as('ledger_totals');

  const netSurplusSql = sql`(${ledgerTotals.earnings} - ${ledgerTotals.expenses})`;
  const undistributedSql = sql`GREATEST(0::numeric, ${netSurplusSql} - ${ledgerTotals.runReserve} - ${ledgerTotals.runDistributed})`;
  const reserveOnRemainderSql = sql`GREATEST(0::numeric, ROUND(${undistributedSql} * ${reservePercent}::numeric / 100, 2))`;

  const [totals] = await tx
    .select({
      deposits: sql<string>`${ledgerTotals.deposits}::text`,
      withdrawals: sql<string>`${ledgerTotals.withdrawals}::text`,
      earnings: sql<string>`${ledgerTotals.earnings}::text`,
      expenses: sql<string>`${ledgerTotals.expenses}::text`,
      netSurplus: sql<string>`${netSurplusSql}::text`,
      runReserve: sql<string>`${ledgerTotals.runReserve}::text`,
      runDistributed: sql<string>`${ledgerTotals.runDistributed}::text`,
      statutoryReserve: sql<string>`(${ledgerTotals.runReserve} + ${reserveOnRemainderSql})::text`,
      distributableSurplus: sql<string>`(GREATEST(0::numeric, ${undistributedSql} - ${reserveOnRemainderSql}) + ${ledgerTotals.runDistributed})::text`,
    })
    .from(ledgerTotals);

  return {
    totalDeposits: totals?.deposits ?? '0.00',
    totalWithdrawals: totals?.withdrawals ?? '0.00',
    totalEarnings: totals?.earnings ?? '0.00',
    totalExpenses: totals?.expenses ?? '0.00',
    netSurplus: totals?.netSurplus ?? '0.00',
    statutoryReserve: totals?.statutoryReserve ?? '0.00',
    distributableSurplus: totals?.distributableSurplus ?? '0.00',
    runReserve: totals?.runReserve ?? '0.00',
    runDistributed: totals?.runDistributed ?? '0.00',
  };
}
