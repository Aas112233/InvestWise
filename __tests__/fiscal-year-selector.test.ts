import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSelectedFiscalYear } from '@/lib/fiscal-year-context';

/**
 * Regression guard: the header's fiscal-year selector is the app-wide period.
 *
 * Before this, every screen guessed its own year: Analysis/Reports opened on
 * the year open for posting, deposit filters opened empty, forms opened empty —
 * so reviewing 2025-26 meant re-picking the year on every screen.
 *
 * The header now owns the selection (persisted, tenant-validated) and
 * `useFiscalPeriodOptions().defaultFiscalYear` follows it. These tests pin the
 * selection rule and the wiring that makes screens follow it; a screen that
 * stops following is exactly the regression that would go unnoticed.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const CREATED = ['2024', '2025', '2026'];
const FALLBACK = '2026';

describe('header fiscal year selection', () => {
  it('falls back when nothing was stored', () => {
    expect(
      resolveSelectedFiscalYear({
        storedYear: null,
        createdYears: CREATED,
        fallbackYear: FALLBACK,
        pending: false,
        failed: false,
      }),
    ).toBe(FALLBACK);
  });

  it('keeps the stored year when the tenant has it', () => {
    expect(
      resolveSelectedFiscalYear({
        storedYear: '2025',
        createdYears: CREATED,
        fallbackYear: FALLBACK,
        pending: false,
        failed: false,
      }),
    ).toBe('2025');
  });

  it('trusts the stored year while the year list is still loading or failed', () => {
    // Second-guessing it here would flash the default year and refetch it.
    for (const state of [{ pending: true, failed: false }, { pending: false, failed: true }]) {
      expect(
        resolveSelectedFiscalYear({
          storedYear: '2025',
          createdYears: [],
          fallbackYear: FALLBACK,
          ...state,
        }),
      ).toBe('2025');
    }
  });

  it('rejects a stored year this tenant does not have', () => {
    // Another tenant's year, or one deleted since: every screen would sit on a
    // period with no data and posting would be refused.
    expect(
      resolveSelectedFiscalYear({
        storedYear: '2019',
        createdYears: CREATED,
        fallbackYear: FALLBACK,
        pending: false,
        failed: false,
      }),
    ).toBe(FALLBACK);
  });
});

describe('period options follow the header', () => {
  it('derives defaultFiscalYear from the header selection', () => {
    const src = read('lib/fiscal-period-options.ts');
    expect(src).toContain('useFiscalYear()');
    expect(src).toContain('headerFiscalYear ?? openFiscalYear ?? currentFiscalYear');
    // Posting forms must NOT seed from a closed year — the write rejects it.
    expect(src).toContain('defaultPostableFiscalYear');
    expect(src).toContain('yearOptions.some((option) => option.value === defaultFiscalYear)');
  });

  it('seeds posting forms from the postable header year, not from any year', () => {
    for (const path of [
      'components/deposits/deposit-modal.tsx',
      'components/deposits/deposit-request-view.tsx',
      'components/deposits/bulk-deposit-request-modal.tsx',
      'components/deposits/bulk-deposit-modal.tsx',
      'components/deposits/single-member-bulk-deposit.tsx',
    ]) {
      const src = read(path);
      expect(src, path).toContain('defaultPostableFiscalYear');
    }
  });

  it('makes read screens follow a header change', () => {
    for (const path of [
      'app/analysis/page.tsx',
      'components/reports/reports-view.tsx',
      'components/deposits/deposits-list-view.tsx',
    ]) {
      const src = read(path);
      expect(src, path).toContain('useFiscalYearSync');
      // The sync callback must be stable, or the effect would clear the user's
      // own pick on every render.
      expect(src, path).toMatch(/useCallback\(/);
    }
  });

  it('offers closed years to the deposits filter but not to posting forms', () => {
    // The header can point at a closed year; its history is what the desk
    // filters for, and posting must never offer it.
    expect(read('components/deposits/deposits-list-view.tsx')).toContain('yearOptionsAll: yearOptions');
  });
});

describe('header selector', () => {
  it('renders a control, not a label, and persists through the provider', () => {
    const nav = read('components/layout/top-nav.tsx');
    expect(nav).toContain('useFiscalYear()');
    expect(nav).toContain('setFiscalYear(option.value)');
    expect(nav).toContain('role="listbox"');
    expect(nav).toContain('aria-selected');
    // A past-year review must be visually distinct from the live year.
    expect(nav).toContain('isHistorical');
  });

  it('mounts the provider above the pages so the choice survives navigation', () => {
    const providers = read('lib/providers.tsx');
    expect(providers).toContain('FiscalYearProvider');
    // AppShell remounts per route — the selection must not live there.
    expect(read('components/layout/app-shell.tsx')).not.toContain('FiscalYearProvider');
  });

  it('persists the choice and validates it against the tenant', () => {
    const ctx = read('lib/fiscal-year-context.tsx');
    expect(ctx).toContain('investwise:fiscal-year');
    expect(ctx).toContain('resolveSelectedFiscalYear');
    expect(ctx).toContain('writeStoredYear');
  });
});
