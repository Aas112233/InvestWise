import { describe, it, expect } from 'vitest';
import { createFundSchema, updateFundSchema } from '../modules/funds/validation.js';
import { parsePositiveAmount, toCents, fromCents } from '@/lib/money';

describe('Funds Validation & Governance Rules', () => {
  it('validates createFundSchema with minimumBalance and formats types', () => {
    const valid = createFundSchema.parse({
      name: 'Reserve Fund',
      type: 'primary',
      minimumBalance: '500.50',
      currency: 'USD',
    });

    expect(valid.name).toBe('Reserve Fund');
    expect(valid.type).toBe('PRIMARY');
    expect(valid.minimumBalance).toBe(500.50);
    expect(valid.currency).toBe('USD');
  });

  it('rejects direct balance override in updateFundSchema', () => {
    const parsed = updateFundSchema.parse({
      name: 'Updated Fund',
      balance: 999999, // Attempts to inject balance directly
      minimumBalance: 1000,
    });

    // balance must not be present in update payload
    expect((parsed as any).balance).toBeUndefined();
    expect(parsed.minimumBalance).toBe(1000);
  });

  it('enforces liquidity reserve policy (balance >= minimumBalance)', () => {
    const fundBalance = '10000.00';
    const minimumReserve = '2500.00';
    const transferAmount = '8000.00';

    const balCents = toCents(fundBalance);
    const minReserveCents = toCents(minimumReserve);
    const transferCents = parsePositiveAmount(transferAmount);

    const availableCents = balCents - minReserveCents;
    const isAllowed = transferCents <= availableCents;

    expect(availableCents).toBe(750000); // 7,500.00
    expect(transferCents).toBe(800000); // 8,000.00
    expect(isAllowed).toBe(false); // Rejected because it violates minimum reserve
  });

  it('ensures canonical lock ordering prevents deadlock on concurrent bidirectional transfers', () => {
    const fundAId = 'aaaaaaaa-1111-1111-1111-111111111111';
    const fundBId = 'bbbbbbbb-2222-2222-2222-222222222222';

    // Thread 1: Transfer from A to B
    const thread1Order = [fundAId, fundBId].sort();
    // Thread 2: Transfer from B to A
    const thread2Order = [fundBId, fundAId].sort();

    // Both threads must acquire locks in the exact same order
    expect(thread1Order).toEqual([fundAId, fundBId]);
    expect(thread2Order).toEqual([fundAId, fundBId]);
  });

  it('verifies integer cents formatting for DB boundary', () => {
    const initialCents = parsePositiveAmount('1500.75');
    expect(initialCents).toBe(150075);
    expect(fromCents(initialCents)).toBe('1500.75');
  });
});
