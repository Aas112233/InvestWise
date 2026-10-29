/**
 * H7 REGRESSION LOCK — "no month restriction" must never become "no month attribution".
 *
 * A flexible deposit may arrive without an explicit period, and it is still written with a
 * `deposit_month`. That is not cosmetic: `app/api/analytics/analysis/route.ts` and
 * `app/api/analytics/stats/route.ts` RANGE-FILTER on the column, and a range comparison against
 * NULL is NULL — so the row is excluded with no error, no zero, no warning. The deposit would sit
 * in the ledger and simply not exist in the fiscal-year report. In a product that moves real
 * member money, silent under-reporting of collections is the worst available failure mode
 * (docs/DEPOSIT_SCHEDULE_DESIGN.md §1, §7 H7).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveDepositMonthKey } from '../server/src/modules/finance/service';

/** The exact regex `analytics/stats/route.ts` uses to reject malformed period keys. */
const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const read = (relativePath: string): string => {
  const absolute = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  if (!existsSync(absolute)) throw new Error(`${relativePath} is missing — H7 guard gone.`);
  return readFileSync(absolute, 'utf8');
};

describe('resolveDepositMonthKey always attributes a period', () => {
  it('derives the period from the collected date when none was sent (the flexible case)', () => {
    // A flexible member deposits on the 21st with no period chosen. The ledger must
    // still know which month the money belongs to.
    const key = resolveDepositMonthKey(null, new Date('2026-10-21T09:00:00Z'), 'Asia/Dhaka');
    expect(key).toBe('2026-10');
    expect(key).toMatch(PERIOD_KEY);
  });

  it('never returns empty or null for ANY absent input — the values that break reporting', async () => {
    const dates = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T23:59:59Z'),
      new Date('2028-02-29T12:00:00Z'),
      new Date('2026-10-31T23:30:00Z'),
    ];
    for (const absent of [null, undefined, '']) {
      for (const date of dates) {
        for (const tz of ['Asia/Dhaka', 'Asia/Riyadh', 'UTC']) {
          const key = resolveDepositMonthKey(absent as string | null, date, tz);
          expect(typeof key).toBe('string');
          expect(key).toMatch(PERIOD_KEY);
        }
      }
    }
  });

  it('an explicit month wins over the collected date, so an officer can attribute to any period', () => {
    // Collected in November, recorded for October — still October in the ledger.
    expect(resolveDepositMonthKey('2026-10', new Date('2026-11-04T09:00:00Z'), 'Asia/Dhaka')).toBe('2026-10');
  });

  it('rejects a malformed explicit month instead of quietly substituting one', () => {
    // §8: the write path must never guess the accounting period.
    expect(() => resolveDepositMonthKey('2026-13', new Date(), 'Asia/Dhaka')).toThrow('YYYY-MM');
    expect(() => resolveDepositMonthKey('October', new Date(), 'Asia/Dhaka')).toThrow(/depositMonth/);
  });

  it('uses the tenant calendar, not UTC, at the month boundary', () => {
    // 23:30Z on 31 October is already 1 November in Dhaka (UTC+6). Attribution follows
    // the tenant's wall clock; a UTC-only read would book it in the wrong period.
    const late = new Date('2026-10-31T23:30:00Z');
    expect(resolveDepositMonthKey(null, late, 'Asia/Dhaka')).toBe('2026-11');
    expect(resolveDepositMonthKey(null, late, 'UTC')).toBe('2026-10');
  });
});

describe('the reporting paths that make the invariant load-bearing', () => {
  it('analytics range-filters deposit_month, so a NULL row is excluded rather than shown as zero', () => {
    const analysis = read('app/api/analytics/analysis/route.ts');
    expect(analysis).toContain('slotStartKey');
    // Documented here so a future "make deposit_month nullable" change fails loudly.
    const stats = read('app/api/analytics/stats/route.ts');
    expect(stats).toMatch(/depositMonth/);
  });

  it('no deposit insert coerces the period to null', () => {
    const service = read('server/src/modules/finance/service.ts');
    expect(service).not.toContain('depositMonth: monthKey || null');
    expect(service).toContain('depositMonth: monthKey,');
  });
});
