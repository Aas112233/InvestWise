import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: every accounting-period picker is driven by the tenant's
 * fiscal calendar, from ONE option source.
 *
 * The audit of 2026-10-16 found eleven year selectors across four different
 * ranges with three label conventions, and five of them wrote into the same
 * `transactions.depositMonth` column while disagreeing about which years were
 * even pickable. `components/deposits/shared.ts`'s `recentYears()` (5 calendar
 * years) and `buildDepositYearOptions()` (12 calendar years) produced arrays
 * that were fed to a component literally labelled "Fiscal year", and Reports
 * Monthly sent a calendar year under a payload key called `fiscalMonth`.
 *
 * They now all take `useFiscalPeriodOptions()` (lib/fiscal-period-options.ts):
 * the year dropdown is the tenant's fiscal year ("FY 2025-26" → "2025"), the
 * month dropdown is the twelve months of that year in fiscal order, valued with
 * the absolute calendar month it names ("2026-03"). Storage and the server
 * contract are unchanged — `depositMonth` and `fiscalMonth` stay YYYY-MM.
 *
 * Asserted at the source level; no database required.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** Forms that POST into a period, so only an OPEN year is legal. */
const POSTING_FORMS = [
  'components/deposits/deposit-modal.tsx',
  'components/deposits/deposit-request-view.tsx',
  'components/deposits/bulk-deposit-modal.tsx',
  'components/deposits/bulk-deposit-request-modal.tsx',
];

/** Screens that READ a period. */
const READ_SCREENS = [
  'components/deposits/deposits-list-view.tsx',
  'components/reports/reports-view.tsx',
  'components/analysis/analysis-view.tsx',
];

/** Screens that ask the user for an accounting period. */
const PERIOD_SCREENS = [
  ...POSTING_FORMS,
  ...READ_SCREENS,
];

describe('fiscal period pickers', () => {
  it('builds every period dropdown from the tenant fiscal calendar', () => {
    for (const path of PERIOD_SCREENS) {
      const source = read(path);
      expect(source, `${path} must use the shared fiscal options`).toContain('useFiscalPeriodOptions');
      expect(source, `${path} reintroduced a calendar-year array`).not.toMatch(
        /recentYears|buildDepositYearOptions|buildDepositMonthOptions/,
      );
    }
  });

  it('never composes a period from a fiscal year plus a month number', () => {
    for (const path of PERIOD_SCREENS) {
      const source = read(path);
      expect(source, `${path} rebuilt a fiscal-year-plus-month-number concatenation`).not.toMatch(
        /fiscalYear\}-\$\{/,
      );
    }
  });

  it('sends the picked period on the wire as an absolute calendar month', () => {
    const bulk = read('components/deposits/bulk-deposit-modal.tsx');
    expect(bulk).toContain('const monthKey = month.month;');
    const excel = read('components/deposits/bulk-excel-import.tsx');
    expect(excel).toContain('const monthKey = month.month;');
    const reports = read('components/reports/reports-view.tsx');
    expect(reports).toContain('fiscalMonth: periodType === "Monthly" ? monthlyKey : undefined');
  });
});

describe('active fiscal year', () => {
  it('comes from the tenant period rows, not the wall clock', () => {
    // One query for every picker, served by the tenant-readable endpoint.
    const options = read('lib/fiscal-period-options.ts');
    expect(options).toContain('"/fiscal/years"');
    expect(read('components/reports/reports-view.tsx')).toContain('defaultFiscalYear');
    expect(read('app/analysis/page.tsx')).toContain('useFiscalPeriodYears');
  });

  it('offers only the year open for posting on every picker', () => {
    for (const path of PERIOD_SCREENS) {
      const source = read(path);
      expect(source, `${path} must use the shared fiscal options`).toContain('useFiscalPeriodOptions');
      // The old per-screen intent flag is gone: every picker now narrows to
      // OPEN years at the one source, so none may reintroduce the split.
      expect(source, `${path} reintroduced the removed forPosting flag`).not.toContain('forPosting');
    }
    // The single filter that decides what any picker may offer.
    expect(read('lib/fiscal-period-options.ts')).toContain('period.status === "OPEN"');
  });

  it('reads the period list without needing FISCAL READ', () => {
    const route = read('app/api/fiscal/years/route.ts');
    expect(route).toContain('requireTenant(tenantId, user)');
    expect(route).toContain('eq(fiscalPeriods.tenantId, scopedTenantId)');
    // A clerk posting deposits holds DEPOSITS WRITE, not FISCAL READ; gating
    // this read would leave the posting picker with nothing to list.
    expect(route).not.toContain('hasScreenPermission');
  });
});

describe('fiscal year management screen', () => {
  it('offers only open years, from the tenant period endpoint', () => {
    const view = read('components/fiscal/fiscal-periods-view.tsx');
    // Same single source as every other picker.
    expect(view).toContain('useFiscalPeriodYears');
    expect(view).toContain('period.status === "OPEN"');
    // No calendar-derived ±5 window: it let an operator pick a year that already
    // existed (rejected on submit as an overlap) or one that was never created.
    expect(view).not.toMatch(/Array\.from\(\{ length: 11 \}/);
    expect(view).not.toContain('fiscalStartYearForDate');
  });
});
