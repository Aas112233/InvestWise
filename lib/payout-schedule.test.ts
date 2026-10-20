import { describe, expect, it } from 'vitest';
import { MoneyError } from './money';
import {
  MAX_PAYOUT_INSTALLMENTS,
  addMonthsClamped,
  buildPayoutSchedule,
  earliestFirstDueDate,
} from './payout-schedule';

describe('buildPayoutSchedule', () => {
  it('splits a divisible total evenly', () => {
    const plan = buildPayoutSchedule({
      totalCents: 1_200_00,
      installmentCount: 4,
      intervalMonths: 3,
      firstDueDate: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(plan.map((p) => p.amountCents)).toEqual([30000, 30000, 30000, 30000]);
    expect(plan.map((p) => p.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('carries the indivisible cents on the last phase so the total is exact', () => {
    // 32,500.00 over 3 phases has no even cent split.
    const plan = buildPayoutSchedule({
      totalCents: 3_250_000,
      installmentCount: 3,
      intervalMonths: 1,
      firstDueDate: new Date('2026-11-20T00:00:00.000Z'),
    });
    expect(plan.map((p) => p.amountCents)).toEqual([1083333, 1083333, 1083334]);
    const sum = plan.reduce((acc, p) => acc + p.amountCents, 0);
    expect(sum).toBe(3_250_000);
  });

  it('keeps a one-time payout as a single full-amount phase', () => {
    const plan = buildPayoutSchedule({
      totalCents: 12_500_00,
      installmentCount: 1,
      intervalMonths: 1,
      firstDueDate: new Date('2026-11-20T00:00:00.000Z'),
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.amountCents).toBe(12_500_00);
  });

  it('steps due dates by the interval in whole months', () => {
    const plan = buildPayoutSchedule({
      totalCents: 100_00,
      installmentCount: 3,
      intervalMonths: 2,
      firstDueDate: new Date('2026-11-20T00:00:00.000Z'),
    });
    expect(plan.map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-11-20',
      '2027-01-20',
      '2027-03-20',
    ]);
  });

  it('rejects nonsense totals, counts and intervals instead of guessing', () => {
    const base = {
      installmentCount: 3,
      intervalMonths: 1,
      firstDueDate: new Date('2026-11-20T00:00:00.000Z'),
    };
    expect(() => buildPayoutSchedule({ ...base, totalCents: 0 })).toThrow(MoneyError);
    expect(() => buildPayoutSchedule({ ...base, totalCents: 12.5 })).toThrow(MoneyError);
    expect(() =>
      buildPayoutSchedule({ ...base, totalCents: 100, installmentCount: MAX_PAYOUT_INSTALLMENTS + 1 }),
    ).toThrow(MoneyError);
    expect(() => buildPayoutSchedule({ ...base, totalCents: 100, intervalMonths: 0 })).toThrow(MoneyError);
    expect(() =>
      buildPayoutSchedule({ ...base, totalCents: 100, firstDueDate: new Date('nope') }),
    ).toThrow(MoneyError);
  });
});

describe('addMonthsClamped', () => {
  it('clamps a day-of-month that the target month does not have', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonthsClamped(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(addMonthsClamped(new Date('2026-11-20T00:00:00.000Z'), 2).toISOString().slice(0, 10)).toBe('2027-01-20');
  });

  it('keeps the time of day', () => {
    const out = addMonthsClamped(new Date('2026-11-20T09:30:00.000Z'), 1);
    expect(out.toISOString().slice(11, 16)).toBe('09:30');
  });
});

describe('earliestFirstDueDate', () => {
  it('adds the notice period', () => {
    const now = new Date('2026-10-17T00:00:00.000Z');
    expect(earliestFirstDueDate(now, 30).toISOString().slice(0, 10)).toBe('2026-11-16');
  });

  it('treats a missing or negative notice period as no waiting time', () => {
    const now = new Date('2026-10-17T00:00:00.000Z');
    expect(earliestFirstDueDate(now, 0).getTime()).toBe(now.getTime());
    expect(earliestFirstDueDate(now, -5).getTime()).toBe(now.getTime());
  });
});
