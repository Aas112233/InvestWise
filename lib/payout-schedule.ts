/**
 * Payout schedule math — pure, no DB, so the phase split and due dates can be
 * unit-tested on their own.
 *
 * All money is integer cents (see ./money); never floats. The rounding
 * difference of an uneven split is carried by the LAST installment, so
 * `sum(installments) === totalCents` always holds exactly (§12).
 */
import { MoneyError } from './money';

/** Deliberate ceiling: 10 years of monthly phases covers any agreed exit schedule. */
export const MAX_PAYOUT_INSTALLMENTS = 120;
/** Deliberate ceiling: phases may not be spaced further apart than a year. */
export const MAX_PAYOUT_INTERVAL_MONTHS = 12;

export interface PayoutInstallmentPlan {
  sequence: number;
  dueDate: Date;
  amountCents: number;
}

/** Adds whole months, clamping to the last day of the shorter month (Jan 31 + 1 → Feb 28). */
export function addMonthsClamped(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDayOfMonth = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDayOfMonth));
  return out;
}

/**
 * Splits `totalCents` into `installmentCount` phases spaced `intervalMonths`
 * apart, starting at `firstDueDate`. A one-time payout is simply
 * `installmentCount = 1`.
 */
export function buildPayoutSchedule(input: {
  totalCents: number;
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: Date;
}): PayoutInstallmentPlan[] {
  const { totalCents, installmentCount, intervalMonths, firstDueDate } = input;

  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new MoneyError('Payout total must be a positive amount', 'INVALID_PAYOUT_AMOUNT');
  }
  if (
    !Number.isInteger(installmentCount) ||
    installmentCount < 1 ||
    installmentCount > MAX_PAYOUT_INSTALLMENTS
  ) {
    throw new MoneyError(
      `Number of installments must be between 1 and ${MAX_PAYOUT_INSTALLMENTS}`,
      'INVALID_INSTALLMENT_COUNT',
    );
  }
  if (
    !Number.isInteger(intervalMonths) ||
    intervalMonths < 1 ||
    intervalMonths > MAX_PAYOUT_INTERVAL_MONTHS
  ) {
    throw new MoneyError(
      `Interval between installments must be between 1 and ${MAX_PAYOUT_INTERVAL_MONTHS} months`,
      'INVALID_INTERVAL_MONTHS',
    );
  }
  if (!(firstDueDate instanceof Date) || Number.isNaN(firstDueDate.getTime())) {
    throw new MoneyError('First installment date is not a valid date', 'INVALID_DUE_DATE');
  }

  const base = Math.floor(totalCents / installmentCount);
  const remainder = totalCents - base * installmentCount;

  return Array.from({ length: installmentCount }, (_, index) => ({
    sequence: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index * intervalMonths),
    // The last phase absorbs the indivisible cents so the phases still add up
    // to the exact reserved balance.
    amountCents: base + (index === installmentCount - 1 ? remainder : 0),
  }));
}

/**
 * The earliest date the first phase may fall on: the tenant's configured
 * withdrawal notice period (`system_settings.withdrawal_notice_days`), counted
 * from `now`. An exit payout is not an instant cash-out — the organisation
 * needs notice to raise the money.
 */
export function earliestFirstDueDate(now: Date, noticeDays: number): Date {
  const days = Number.isInteger(noticeDays) && noticeDays > 0 ? noticeDays : 0;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
