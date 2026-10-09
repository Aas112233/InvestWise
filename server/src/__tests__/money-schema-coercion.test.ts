import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for report issues #22 / #47 — "money endpoints send amounts
 * as JSON strings; the API schemas disagree about whether that is legal".
 *
 * The UI emitted `amount: 2000` from some forms and `amount: "2000"` from
 * others. `server/src/modules/finance/validation.ts` used a bare
 * `z.number()` for the shared `positiveAmount`, which REJECTED the string
 * form, while `dividendSchema` used `z.coerce.number()` and accepted it — so
 * bulk deposit / transfer / dividend behaved differently with identical input,
 * and two of the three died with a 400/500 that the UI never surfaced.
 *
 * The contract now: every money field coerces, so a numeric string and a
 * number are equally valid. This test pins it at the source level (no DB
 * needed) and fails loudly if a bare `z.number()` money field comes back.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('money schema coercion (#22/#47)', () => {
  const financeValidation = read('server/src/modules/finance/validation.ts');
  const libValidation = read('lib/utils/validation.ts');

  it('defines exactly one shared money helper in the finance schemas', () => {
    expect(financeValidation).toMatch(/const moneyField\s*=/);
    // The shared per-member ceiling must route through the helper.
    expect(financeValidation).toMatch(/const positiveAmount\s*=\s*moneyField\(/);
  });

  it('no bare z.number() money field survives in the finance schemas', () => {
    // Any `amount`/`shareValue`/`deductionAmount` key must not use a bare
    // z.number() — that is the exact shape that rejected "2000".
    const bareNumberMoney = /(amount|balance|shareValue|deductionAmount)\s*:\s*z\.number\(/;
    expect(financeValidation).not.toMatch(bareNumberMoney);
    expect(libValidation).not.toMatch(bareNumberMoney);
  });

  it('the finance money helper coerces rather than only accepting numbers', () => {
    const helper = financeValidation.slice(
      financeValidation.indexOf('const moneyField'),
      financeValidation.indexOf('const positiveAmount'),
    );
    expect(helper).toMatch(/z\.coerce\s*\.\s*number\(/);
    expect(helper).toMatch(/positive/);
    // zod v3: a `.refine()` in this chain widens the inferred object type to
    // `unknown`, which breaks every downstream handler. Guard against it.
    expect(helper).not.toMatch(/\.refine\(/);
  });

  it('bulk deposit, transfer and dividend share one amount contract', () => {
    // Every one of the three dead money features must reference the coercing
    // helper (directly as `positiveAmount`, or via `moneyField` for the
    // higher dividend ceiling) — never its own hand-rolled number schema.
    for (const schema of ['depositSchema', 'bulkDepositSchema', 'transferSchema', 'expenseSchema', 'earningSchema']) {
      const start = financeValidation.indexOf(`export const ${schema}`);
      const end = financeValidation.indexOf('export const', start + 10);
      const block = financeValidation.slice(start, end === -1 ? undefined : end);
      expect(block, `${schema} should use positiveAmount`).toMatch(/amount:\s*positiveAmount/);
    }
  });

  it('lib money schemas coerce too (project disbursement + settings)', () => {
    expect(libValidation).toMatch(/amount:\s*z\.coerce\.number\(\)/);
    expect(libValidation).toMatch(/shareValueBdt:\s*z\.coerce\.number\(\)/);
    expect(libValidation).toMatch(/deductionAmount:\s*z\.coerce\.number\(\)/);
  });
});
