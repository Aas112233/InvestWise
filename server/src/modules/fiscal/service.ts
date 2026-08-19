import { getDb } from '../../config/database.js';
import { fiscalPeriods, transactions, auditLogs, systemSettings } from '../../db/schema/index.js';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { NotFoundError, AppError } from '../../shared/errors.js';

export async function createFiscalPeriod(data: {
  year: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  notes?: string;
}) {
  const db = getDb();

  const startDate = new Date(data.periodStart);
  const endDate = new Date(data.periodEnd);

  if (endDate <= startDate) {
    throw new AppError('Period end date must be after start date', 400, 'INVALID_DATE_RANGE');
  }

  const [period] = await db
    .insert(fiscalPeriods)
    .values({
      year: data.year,
      periodStart: startDate,
      periodEnd: endDate,
      status: 'OPEN',
      notes: data.notes || null,
    })
    .returning();

  return period;
}

export async function listFiscalPeriods() {
  const db = getDb();

  const periods = await db
    .select()
    .from(fiscalPeriods)
    .orderBy(desc(fiscalPeriods.year), desc(fiscalPeriods.periodStart));

  return periods.map((p) => ({
    ...p,
    totalDeposits: Number(p.totalDeposits ?? 0),
    totalWithdrawals: Number(p.totalWithdrawals ?? 0),
    totalEarnings: Number(p.totalEarnings ?? 0),
    totalExpenses: Number(p.totalExpenses ?? 0),
    netSurplus: Number(p.netSurplus ?? 0),
    statutoryReserve: Number(p.statutoryReserve ?? 0),
    distributableSurplus: Number(p.distributableSurplus ?? 0),
    actualDistributed: Number(p.actualDistributed ?? 0),
    retainedEarnings: Number(p.retainedEarnings ?? 0),
  }));
}

export async function getFiscalPeriodById(id: string) {
  const db = getDb();

  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.id, id))
    .limit(1);

  if (!period) throw new NotFoundError('Fiscal period');

  return {
    ...period,
    totalDeposits: Number(period.totalDeposits ?? 0),
    totalWithdrawals: Number(period.totalWithdrawals ?? 0),
    totalEarnings: Number(period.totalEarnings ?? 0),
    totalExpenses: Number(period.totalExpenses ?? 0),
    netSurplus: Number(period.netSurplus ?? 0),
    statutoryReserve: Number(period.statutoryReserve ?? 0),
    distributableSurplus: Number(period.distributableSurplus ?? 0),
    actualDistributed: Number(period.actualDistributed ?? 0),
    retainedEarnings: Number(period.retainedEarnings ?? 0),
  };
}

export async function closeFiscalPeriod(id: string, userId: string, userName: string, notes?: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, id))
      .for('update')
      .limit(1);

    if (!period) throw new NotFoundError('Fiscal period');
    if (period.status === 'CLOSED') {
      throw new AppError('Fiscal period is already closed', 400, 'PERIOD_ALREADY_CLOSED');
    }

    // 1. Fetch system settings for statutory reserve %
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const reservePct = Number(settings?.statutoryReservePercent ?? 10) / 100;

    // 2. Aggregate transactions within periodStart and periodEnd
    const [aggregates] = await tx
      .select({
        deposits: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Deposit' THEN ${transactions.amount} ELSE 0 END), 0)`,
        withdrawals: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Withdrawal' THEN ${transactions.amount} ELSE 0 END), 0)`,
        earnings: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Earning' THEN ${transactions.amount} ELSE 0 END), 0)`,
        expenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'Expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.isDeleted, false),
          inArray(transactions.status, ['Completed']),
          sql`${transactions.date} >= ${period.periodStart.toISOString()}::timestamptz`,
          sql`${transactions.date} <= ${period.periodEnd.toISOString()}::timestamptz`,
        ),
      );

    const totalDeposits = Number(aggregates?.deposits ?? 0);
    const totalWithdrawals = Number(aggregates?.withdrawals ?? 0);
    const totalEarnings = Number(aggregates?.earnings ?? 0);
    const totalExpenses = Number(aggregates?.expenses ?? 0);

    const netSurplus = totalEarnings - totalExpenses;
    const statutoryReserve = Math.max(0, netSurplus * reservePct);
    const distributableSurplus = Math.max(0, netSurplus - statutoryReserve);

    const [updated] = await tx
      .update(fiscalPeriods)
      .set({
        status: 'CLOSED',
        totalDeposits: totalDeposits.toFixed(2),
        totalWithdrawals: totalWithdrawals.toFixed(2),
        totalEarnings: totalEarnings.toFixed(2),
        totalExpenses: totalExpenses.toFixed(2),
        netSurplus: netSurplus.toFixed(2),
        statutoryReserve: statutoryReserve.toFixed(2),
        distributableSurplus: distributableSurplus.toFixed(2),
        closedBy: userId,
        closedAt: new Date(),
        notes: notes || period.notes,
        updatedAt: new Date(),
      })
      .where(eq(fiscalPeriods.id, id))
      .returning();

    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'CLOSE_FISCAL_PERIOD',
      resourceType: 'FiscalPeriod',
      resourceId: id,
      details: {
        year: period.year,
        netSurplus,
        distributableSurplus,
        statutoryReserve,
      },
      status: 'SUCCESS',
    });

    return updated;
  });
}

export async function reopenFiscalPeriod(id: string, userId: string, userName: string) {
  const db = getDb();

  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.id, id))
    .limit(1);

  if (!period) throw new NotFoundError('Fiscal period');

  const [updated] = await db
    .update(fiscalPeriods)
    .set({
      status: 'OPEN',
      closedBy: null,
      closedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(fiscalPeriods.id, id))
    .returning();

  await db.insert(auditLogs).values({
    userId,
    userName,
    action: 'REOPEN_FISCAL_PERIOD',
    resourceType: 'FiscalPeriod',
    resourceId: id,
    details: { year: period.year },
    status: 'SUCCESS',
  });

  return updated;
}
