import { describe, expect, it } from 'vitest';
import {
  fiscalMonthOffsetForDate,
  fiscalMonthSequence,
  fiscalStartYearForDate,
  isFiscalMonthEvaluated,
  nextFiscalStartYear,
  resolveCalendarMonthBounds,
  resolveFiscalBounds,
  resolveFiscalQuarterBounds,
} from './fiscal-periods';

describe('fiscal period date rules', () => {
  it('derives July–June bounds and fiscal label in UTC', () => {
    const period = resolveFiscalBounds(2025, 'July', 'June');
    expect(period.label).toBe('2025-26');
    expect(period.periodStart.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('keeps January–December in one calendar year', () => {
    const period = resolveFiscalBounds(2026, 'January', 'December');
    expect(period.label).toBe('2026');
    expect(period.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(period.periodEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('rejects invalid month names and same-month periods', () => {
    expect(() => resolveFiscalBounds(2025, 'Jul', 'June')).toThrow(/full English month name/);
    expect(() => resolveFiscalBounds(2025, 'July', 'July')).toThrow(/must differ/);
  });

  it('uses the start-month boundary to determine current and next FY', () => {
    expect(fiscalStartYearForDate(new Date('2026-06-30T23:59:59.000Z'), 'July')).toBe(2025);
    expect(fiscalStartYearForDate(new Date('2026-07-01T00:00:00.000Z'), 'July')).toBe(2026);
    expect(nextFiscalStartYear(new Date('2026-10-05T12:00:00.000Z'), 'July', [2024, 2025, 2026])).toBe(2027);
  });

  it('enumerates fiscal months across the calendar-year boundary', () => {
    const months = fiscalMonthSequence('July');
    expect(months.map((month) => month.shortKey)).toEqual([
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    ]);
    expect(months[0]?.index).toBe(6);
    expect(months[11]?.index).toBe(5);
  });

  it('evaluates fiscal slots in UTC fiscal position, including the current month', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    expect(fiscalMonthOffsetForDate(now, 'July')).toBe(6);
    expect(isFiscalMonthEvaluated(2024, 11, now, 'July')).toBe(true);
    expect(isFiscalMonthEvaluated(2025, 6, now, 'July')).toBe(true);
    expect(isFiscalMonthEvaluated(2025, 7, now, 'July')).toBe(false);
    expect(isFiscalMonthEvaluated(2026, 0, now, 'July')).toBe(false);
  });

  it('rejects invalid fiscal month positions', () => {
    expect(() => fiscalMonthSequence('Jul')).toThrow(/full English month name/);
    expect(() => isFiscalMonthEvaluated(2026, 12, new Date('2026-01-15T00:00:00.000Z'), 'July'))
      .toThrow(/offset must be an integer/);
  });

  it('builds report month and fiscal quarter boundaries', () => {
    const month = resolveCalendarMonthBounds('2026-02');
    expect(month.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-02-28T23:59:59.999Z');

    const quarter = resolveFiscalQuarterBounds(2025, 'Q1', 'July');
    expect(quarter.start.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(quarter.end.toISOString()).toBe('2025-09-30T23:59:59.999Z');
  });
});
