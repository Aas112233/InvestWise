/**
 * Multi-currency display guards.
 *
 * The platform offers ~20 base currencies (lib/org-setup.ts CURRENCIES) and the tenant's choice is
 * the only thing that decides how every amount is labelled. A literal "BDT" left in a view does not
 * crash and does not fail any type check — it prints the wrong currency in front of a correct
 * number, which is the worst kind of financial defect because it looks right. These tests exist so
 * that cannot come back quietly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Line comments are excluded: one explains why the literal was removed. */
const codeOf = (src: string) => src.replace(/^\s*\/\/.*$/gm, '');

describe('money is labelled with the tenant currency, never a literal', () => {
  const files = [...sourceFiles('components'), ...sourceFiles('app')];

  it('no view formats money as BDT by hand', () => {
    const offenders = files
      .filter((file) => {
        const code = codeOf(readFileSync(file, 'utf8'));
        return /formatMoney\([^)]*"BDT"/.test(code) || /currency="BDT"/.test(code);
      })
      .sort();
    expect(offenders).toEqual([]);
  });

  it('formatMoney cannot be called without naming a currency', () => {
    // The optional `= "BDT"` default was the original defect: the dashboard
    // (first screen after login), Goals and the waive-penalty modal all printed
    // BDT for a SAR tenant. Required parameter → every new call site must decide.
    expect(readFileSync('lib/formatters.ts', 'utf8')).not.toMatch(/currencyCode: string = /);
  });

  it('the screens that once hardcoded it now read the tenant setting', () => {
    for (const file of [
      'components/dashboard/dashboard-view.tsx',
      'components/goals/goals-view.tsx',
      'components/governance/waive-penalty-modal.tsx',
      'components/expenses/expenses-view.tsx',
      'components/analysis/analysis-view.tsx',
      'app/projects/page.tsx',
      'components/projects/project-list-view.tsx',
      'components/projects/project-detail-view.tsx',
      'components/projects/project-form-modal.tsx',
      'components/projects/project-update-modal.tsx',
      'components/projects/distribute-returns-modal.tsx',
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('useTenantCurrency');
      expect(src).toMatch(/const (currency|tenantCurrency) = useTenantCurrency\(\);/);
    }
  });

  it('the helper keeps the UI locale it had before — only the currency changed', () => {
    // Dropping intlLocaleFor would silently switch a bn/hi/ur screen back to en-US digits.
    expect(readFileSync('components/analysis/analysis-view.tsx', 'utf8')).toContain(
      'formatMoney(n, tenantCurrency, { locale: intlLocaleFor(locale) })',
    );
  });
});

describe('printed amounts name the currency of the document', () => {
  it('every amount-in-words call site passes the currency', () => {
    const files = [
      'components/documents/deposit-receipt.tsx',
      'components/documents/ledger-voucher.tsx',
      'components/documents/project-charter.tsx',
      'components/documents/project-update-receipt.tsx',
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // A one-argument call would print taka/poisha on a riyal receipt.
      expect(src).not.toMatch(/amountInWords\([^,)]+\)/);
      expect(src).toMatch(/amountInWords\([^,]+, currency\)/);
      expect(src).toContain('useTenantCurrency');
    }
  });
});

describe('base currency is chosen, not typed', () => {
  const settings = () => readFileSync('app/settings/page.tsx', 'utf8');

  it('Settings offers the same list signup and provisioning validate against', () => {
    expect(settings()).toContain('CURRENCIES');
    // A typed value could be stored that Intl rejects, and lib/formatters.ts catches that error and
    // prints "XX 1,234.56" — every amount in the tenant quietly loses its symbol.
    expect(settings()).not.toContain('onChange={set("baseCurrency")}');
    expect(settings()).toMatch(/options=\{currencyOptions\}[\s\S]{0,200}value=\{storedCurrency \|\| null\}/);
  });

  it('keeps a stored code that is not on the offered list', () => {
    // Otherwise opening Settings and pressing Save rewrites that tenant to BDT through the
    // `|| "BDT"` fallback, converting the meaning of every stored amount.
    expect(settings()).toContain('storedCurrency');
    expect(settings()).toMatch(/\[\{ value: storedCurrency, label: storedCurrency \}, \.\.\.CURRENCIES\]/);
  });
});
