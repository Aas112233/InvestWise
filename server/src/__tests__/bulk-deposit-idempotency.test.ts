import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bulkDepositReference } from '../modules/finance/service';
import { bulkDepositSchema } from '../modules/finance/validation';
import { validateBody } from '../middleware/api';
import { isAllowedDepositMethod, normalizePaymentMethods } from '@/lib/payment-methods';

const REQUEST_KEY = '5b7d8fe9-7e0e-4d96-b20a-54b5b074a2d2';
const FUND_ID = '24fe3980-44b8-4c42-8af2-6d4183894d9e';
const MEMBER_ID = '44e221a3-b77b-45ee-ae12-31fc7e4c9c0f';

describe('bulk deposit idempotency', () => {
  it('creates a different deterministic reference for every row', () => {
    const batchId = `BLK-${REQUEST_KEY}`;
    expect([0, 1, 499].map((i) => bulkDepositReference(batchId, i))).toEqual([
      `${batchId}-001`,
      `${batchId}-002`,
      `${batchId}-500`,
    ]);
  });

  it('accepts only UUID request keys at the API boundary', () => {
    const payload = {
      fundId: FUND_ID,
      requestKey: REQUEST_KEY,
      commonMonth: '2026-10',
      deposits: [{ memberId: MEMBER_ID, amount: 1000 }],
    };
    expect(bulkDepositSchema.parse(payload).requestKey).toBe(REQUEST_KEY);
    expect(() => bulkDepositSchema.parse({ ...payload, requestKey: 'reused-key' })).toThrow();
  });

  it('assigns per-row references rather than the shared batch ID', () => {
    const source = readFileSync(
      join(process.cwd(), 'server/src/modules/finance/service.ts'),
      'utf8',
    );
    const start = source.indexOf('export async function bulkAddDeposits');
    const block = source.slice(start);
    expect(block).toContain('referenceNumber: bulkDepositReference(batchId, rowIndex)');
    expect(block).not.toMatch(/referenceNumber:\s*batchId[,\n]/);
  });

  it('sends stable request keys from manual and Excel submissions', () => {
    for (const path of [
      'components/deposits/bulk-deposit-modal.tsx',
      'components/deposits/bulk-excel-import.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source, path).toContain('requestKey: requestRef.current.key');
      expect(source, path).toContain('crypto.randomUUID()');
      expect(source, path).toContain('fingerprint');
    }
  });

  it('strictly validates the accounting month, date and bounded text fields', () => {
    const payload = {
      fundId: FUND_ID,
      requestKey: REQUEST_KEY,
      commonMonth: '2028-02',
      depositMethod: 'Cash',
      deposits: [{ memberId: MEMBER_ID, amount: 1000, depositMonth: '2028-02', date: '2028-02-29' }],
    };
    expect(bulkDepositSchema.safeParse(payload).success).toBe(true);
    expect(bulkDepositSchema.safeParse({ ...payload, commonMonth: '2028-13' }).success).toBe(false);
    expect(
      bulkDepositSchema.safeParse({ ...payload, deposits: [{ ...payload.deposits[0], depositMonth: '02/2028' }] }).success,
    ).toBe(false);
    expect(
      bulkDepositSchema.safeParse({ ...payload, deposits: [{ ...payload.deposits[0], date: '2028-02-30' }] }).success,
    ).toBe(false);
    expect(bulkDepositSchema.safeParse({ ...payload, depositMethod: 'x'.repeat(51) }).success).toBe(false);
    expect(
      bulkDepositSchema.safeParse({
        ...payload,
        deposits: [{ ...payload.deposits[0], name: 'Forged Name', shares: 999 }],
      }).success,
    ).toBe(false);
  });

  it('caps the parsed body and requires JSON content type when requested', async () => {
    const oversized = new Request('http://localhost/api/finance/deposits/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });
    await expect(
      validateBody(oversized, bulkDepositSchema, { maxBytes: 32, requireJsonContentType: true }),
    ).rejects.toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });

    const wrongType = new Request('http://localhost/api/finance/deposits/bulk', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    await expect(
      validateBody(wrongType, bulkDepositSchema, { maxBytes: 1024, requireJsonContentType: true }),
    ).rejects.toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('allows configured payment methods and rejects unknown values', () => {
    const methods = normalizePaymentMethods([{ name: 'Tenant Wallet', type: 'MOBILE' }]);
    expect(isAllowedDepositMethod('Tenant Wallet', methods)).toBe(true);
    expect(isAllowedDepositMethod('Attacker Method', methods)).toBe(false);
  });

  it('authenticates before parsing, rate-limits two dimensions and validates tenant payment methods', () => {
    const handler = readFileSync(join(process.cwd(), 'server/src/modules/finance/handlers.ts'), 'utf8');
    const service = readFileSync(join(process.cwd(), 'server/src/modules/finance/service.ts'), 'utf8');
    const block = handler.slice(handler.indexOf('export async function handleBulkAddDeposits'));
    expect(block.indexOf("requirePermission('DEPOSITS', 'WRITE')")).toBeLessThan(block.indexOf('validateBody(request'));
    // Both dimensions are still enforced — now in ONE shared budget helper, so
    // the bulk POST and the month-grid read cannot drift apart (one of them
    // silently losing a dimension is exactly the regression this guards).
    const limiter = handler.slice(
      handler.indexOf('async function enforceRateLimit'),
      handler.indexOf('export async function handleBulkAddDeposits'),
    );
    expect(limiter.match(/consumeBucket\(/g)).toHaveLength(2);
    expect(limiter).toContain("code: 'RATE_LIMITED'");
    expect(limiter).toContain('RATE_LIMIT_UNAVAILABLE');
    expect(block).toContain('enforceRateLimit(BULK_DEPOSIT_BUDGET');
    expect(block).toContain('BULK_DEPOSIT_MAX_BODY_BYTES');
    expect(service.slice(service.indexOf('export async function bulkAddDeposits'))).toContain(
      'isAllowedDepositMethod(data.depositMethod',
    );
  });
});
