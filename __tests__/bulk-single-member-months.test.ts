import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fiscalMonthKeys } from '@/lib/fiscal-periods';
import { buildFiscalMonthOptions } from '@/lib/fiscal-period-options';
import { depositMonthsOccupiedCondition } from '@/lib/deposit-month-limit';
import { bulkDepositSchema, depositMonthStatusQuerySchema } from '@/server/src/modules/finance/validation';

/**
 * Regression guard: single-member, multi-month bulk deposits.
 *
 * The bulk sheet now offers two collection shapes. "Multiple members" is the
 * original one common month for a list of members; "Single member" records
 * SEVERAL months for ONE member, and must grey out the months that already hold
 * a deposit.
 *
 * Two invariants make that safe, and both are asserted here:
 *
 *  1. The month grid and the write path use ONE fiscal expansion
 *     (`fiscalMonthKeys`) and ONE occupancy rule (`lib/deposit-month-limit.ts`),
 *     so a greyed-out month is exactly a month the POST would reject.
 *  2. A batch row always resolves an accounting month — the server refuses to
 *     guess one (posting against "today" would mis-period the ledger silently).
 *
 * Source-level and pure-function guards; no database required.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const FUND_ID = '24fe3980-44b8-4c42-8af2-6d4183894d9e';
const MEMBER_ID = '44e221a3-b77b-45ee-ae12-31fc7e4c9c0f';
const REQUEST_KEY = '5b7d8fe9-7e0e-4d96-b20a-54b5b074a2d2';

/** Locale-free translator: returns the key, so labels never matter here. */
const t = (key: string) => key;

describe('fiscal month expansion', () => {
  it('returns twelve absolute month keys in fiscal order', () => {
    expect(fiscalMonthKeys(2026, 'July')).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
    expect(fiscalMonthKeys(2026, 'January')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('refuses an out-of-range year or a month name it cannot resolve', () => {
    expect(() => fiscalMonthKeys(1899, 'July')).toThrow();
    expect(() => fiscalMonthKeys(9999, 'July')).toThrow();
    expect(() => fiscalMonthKeys(2026, 'Jul')).toThrow();
  });

  it('drives the picker labels from the same keys the server grid returns', () => {
    // One expansion, two consumers: if these ever diverge the desk would label
    // a month the server does not report (or vice versa).
    for (const startMonth of ['July', 'January', 'April']) {
      expect(buildFiscalMonthOptions(2026, startMonth, t).map((option) => option.value)).toEqual(
        fiscalMonthKeys(2026, startMonth),
      );
    }
  });
});

describe('bulk deposit contract for a multi-month single member', () => {
  it('accepts a month per row with no shared commonMonth', () => {
    const payload = {
      fundId: FUND_ID,
      requestKey: REQUEST_KEY,
      deposits: [
        { memberId: MEMBER_ID, amount: 1000, depositMonth: '2026-07' },
        { memberId: MEMBER_ID, amount: 1000, depositMonth: '2026-08' },
      ],
    };
    const parsed = bulkDepositSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.commonMonth).toBeUndefined();
  });

  it('still accepts the shared-month multi-member shape', () => {
    const payload = {
      fundId: FUND_ID,
      commonMonth: '2026-10',
      deposits: [
        { memberId: MEMBER_ID, amount: 1000 },
        { memberId: '0f3c2e46-4c6f-4d1e-9a1f-2b8a1d7c5e10', amount: 500 },
      ],
    };
    expect(bulkDepositSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a row that resolves no month at all, pointing at the field', () => {
    const result = bulkDepositSchema.safeParse({
      fundId: FUND_ID,
      deposits: [{ memberId: MEMBER_ID, amount: 1000 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['deposits', 0, 'depositMonth']);
  });

  it('lets a common month cover rows that omit their own', () => {
    expect(
      bulkDepositSchema.safeParse({
        fundId: FUND_ID,
        commonMonth: '2026-10',
        deposits: [{ memberId: MEMBER_ID, amount: 1000 }],
      }).success,
    ).toBe(true);
  });

  it('keeps the month format and the strict row shape', () => {
    expect(
      bulkDepositSchema.safeParse({
        fundId: FUND_ID,
        deposits: [{ memberId: MEMBER_ID, amount: 1000, depositMonth: '10/2026' }],
      }).success,
    ).toBe(false);
    expect(
      bulkDepositSchema.safeParse({
        fundId: FUND_ID,
        deposits: [{ memberId: MEMBER_ID, amount: 1000, depositMonth: '2026-10', shares: 99 }],
      }).success,
    ).toBe(false);
  });
});

describe('month-status query contract', () => {
  it('accepts a member and a four-digit fiscal year only', () => {
    expect(depositMonthStatusQuerySchema.safeParse({ memberId: MEMBER_ID, fiscalYear: '2026' }).success).toBe(true);
    expect(depositMonthStatusQuerySchema.safeParse({ memberId: MEMBER_ID, fiscalYear: '26' }).success).toBe(false);
    expect(depositMonthStatusQuerySchema.safeParse({ memberId: 'not-a-uuid', fiscalYear: '2026' }).success).toBe(
      false,
    );
    expect(
      depositMonthStatusQuerySchema.safeParse({ memberId: MEMBER_ID, fiscalYear: '2026', tenantId: 'x' }).success,
    ).toBe(false);
  });
});

describe('one occupancy rule for grid and write', () => {
  it('builds no predicate for an empty month list', () => {
    // An empty list must never degrade into "every deposit of this member".
    expect(depositMonthsOccupiedCondition({ tenantId: 't', memberId: 'm', depositMonthKeys: [] })).toBeNull();
    expect(
      depositMonthsOccupiedCondition({ tenantId: 't', memberId: 'm', depositMonthKeys: ['2026-07'] }),
    ).not.toBeNull();
  });

  it('reads the grid through the shared helper, tenant-scoped', () => {
    const service = read('server/src/modules/finance/service.ts');
    const block = service.slice(service.indexOf('export async function getMemberDepositMonths'));
    expect(block).toContain('findDepositMonthOccupancyInRange');
    // The server expands the fiscal year itself — never a client-supplied
    // month window.
    expect(block).toContain('fiscalMonthKeys');
    expect(block).toContain('eq(members.tenantId, tenantId)');
    expect(block).toContain('eq(members.isDeleted, false)');
  });

  it('refuses a month-less bulk row on the write path too', () => {
    const service = read('server/src/modules/finance/service.ts');
    const block = service.slice(service.indexOf('export async function bulkAddDeposits'));
    expect(block).toContain('resolveBatchRowMonth');
    expect(block).not.toContain("dep.depositMonth || data.commonMonth || ''");
    expect(service).toContain('Every bulk deposit row needs a deposit month');
  });
});

describe('month-status endpoint', () => {
  it('gates on DEPOSITS read, rate-limits, then validates', () => {
    const handlers = read('server/src/modules/finance/handlers.ts');
    const block = handlers.slice(handlers.indexOf('export async function handleGetMemberDepositMonths'));
    expect(block).toContain("requirePermission('DEPOSITS', 'READ')");
    expect(block).toContain('requireTenant(user)');
    expect(block.indexOf('requirePermission')).toBeLessThan(block.indexOf('enforceRateLimit(MONTH_STATUS_BUDGET'));
    expect(block.indexOf('enforceRateLimit')).toBeLessThan(block.indexOf('validateQuery(request'));
    expect(block).toContain('depositMonthStatusQuerySchema');
  });

  it('is wired to a GET route', () => {
    const route = read('app/api/finance/deposits/month-status/route.ts');
    expect(route).toContain('handleGetMemberDepositMonths');
    expect(route).toContain('export async function GET');
  });
});

describe('single-member bulk sheet', () => {
  it('locks occupied months and posts per-row months', () => {
    const ui = read('components/deposits/single-member-bulk-deposit.tsx');
    expect(ui).toContain('useMemberDepositMonths');
    // Occupied (and not-yet-loaded) rows are unselectable.
    expect(ui).toContain('disabled={locked || loading || submitting}');
    // The batch carries the month per row; the shared month is the other scope.
    expect(ui).toContain('depositMonth: month');
    expect(ui).not.toContain('commonMonth');
    // Same idempotency contract as the multi-member sheet.
    expect(ui).toContain('requestKey: requestRef.current.key');
    expect(ui).toContain('fingerprint');
  });

  it('is offered as a second scope in the bulk sheet', () => {
    const modal = read('components/deposits/bulk-deposit-modal.tsx');
    expect(modal).toContain('SingleMemberBulkDeposit');
    expect(modal).toContain('deposits.bulkSingle.scopeMultiple');
    expect(modal).toContain('deposits.bulkSingle.scopeSingle');
  });
});
