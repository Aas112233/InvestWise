import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { getDb } from '@/db/index';
import { fiscalPeriods, systemSettings } from '@/db/schema/index';
import { fiscalStartYearForDate } from '@/lib/fiscal-periods';
import { ConflictError, LockedError, ValidationError } from '@/lib/utils/errors';

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Serialize posting with period creation/closure for this tenant's fiscal year,
 * then lock any matching period row for the rest of the caller's transaction.
 * Taking the advisory lock even when no period exists closes the gap where a
 * period could be created and closed after this check but before the post.
 */
export async function assertFiscalPeriodOpen(
  tx: DbTransaction,
  tenantId: string,
  date: Date,
): Promise<void> {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ValidationError("[Field 'date', Code: invalid_date] Transaction date must be valid");
  }

  const [settings] = await tx
    .select({ fiscalYearStart: systemSettings.fiscalYearStart })
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .for('share')
    .limit(1);
  let fiscalYear: number;
  try {
    fiscalYear = fiscalStartYearForDate(date, settings?.fiscalYearStart || 'July');
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }

  // Same tenant/year advisory key is used by fiscal-period creation and close.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), ${fiscalYear})`);

  const periods = await tx
    .select({ id: fiscalPeriods.id, year: fiscalPeriods.year, status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.tenantId, tenantId),
        lte(fiscalPeriods.periodStart, date),
        gte(fiscalPeriods.periodEnd, date),
      ),
    )
    .orderBy(fiscalPeriods.year, fiscalPeriods.id)
    .for('update');

  if (periods.length > 1) {
    throw new ConflictError('Transaction date matches overlapping fiscal periods');
  }
  const period = periods[0];

  // Fail closed when no period covers this date. Previously a missing row was
  // silently allowed, which meant that until an operator manually created the
  // period for the year, deposits/expenses/transfers posted with no audit
  // boundary and a closed year could never be distinguished from an unopened
  // one. Posting to an undefined fiscal period is a data-integrity error.
  if (!period) {
    throw new ValidationError(
      `No fiscal period is defined for ${fiscalYear}. Create and open the fiscal year before posting transactions.`,
    );
  }

  if (period.status === 'CLOSED') {
    throw new LockedError(`Transactions cannot be posted to closed fiscal year ${period.year}`);
  }
  if (period.status !== 'OPEN') {
    throw new LockedError(`Fiscal year ${period.year} is ${period.status} and is not open for posting`);
  }
}
