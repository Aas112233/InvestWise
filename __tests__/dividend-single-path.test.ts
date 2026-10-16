import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: there must be exactly ONE dividend-distribution path.
 *
 * `POST /api/finance/dividends` used to route to
 * `finance.distributeDividends`, a second, contradictory payout engine that
 * (a) retained no statutory reserve, (b) split a PROJECT's proceeds by every
 * member's organization-wide share count — paying members who never funded the
 * project — and (c) mutated `funds.balance` with a JS read-modify-write, so two
 * concurrent runs could overdraft the fund (baseline audit FIN-007). The client
 * never called it; the live path is `POST /api/dividends/distribute`, which
 * plans through the shared engine (reserve split, per-member payouts) and locks
 * every row `FOR UPDATE`.
 *
 * The wrong engine was removed. This test fails if it is ever re-introduced,
 * at the source level — no database required.
 */

const root = fileURLToPath(new URL('../', import.meta.url));

describe('dividend distribution has a single path', () => {
  it('keeps the correct endpoint', () => {
    expect(existsSync(`${root}app/api/dividends/distribute/route.ts`)).toBe(true);
  });

  it('does not resurrect the legacy /api/finance/dividends endpoint', () => {
    expect(existsSync(`${root}app/api/finance/dividends/route.ts`)).toBe(false);
  });

  it('does not resurrect the legacy service implementation', () => {
    const service = readFileSync(`${root}server/src/modules/finance/service.ts`, 'utf8');
    expect(service).not.toMatch(/export\s+async\s+function\s+distributeDividends/);
    expect(service).not.toMatch(/export\s+interface\s+DividendSummary/);
  });
});
