import { describe, it, expect } from 'vitest';
import { decideReversal, shouldRefundProjectExpenses, shouldRefundProjectEarnings } from './transaction-reversal';

/**
 * These lock in the money-integrity rule that a soft delete must not strand a
 * fund movement. A regression here means a deleted expense/transfer leaves the
 * fund permanently debited (or credited) while the ledger shows the row gone.
 */
describe('decideReversal', () => {
  describe('settled deposits are owned by the revert path', () => {
    it('refuses a Completed deposit and points at the Deposits screen (never an API route)', () => {
      const d = decideReversal({
        type: 'Deposit',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '100.00',
      });
      expect(d.requiresRevertPath).toBe(true);
      expect(d.direction).toBe(0);
      expect(d.fundId).toBeNull();
      // User-facing guidance names the screen, not the endpoint (§11: no
      // route leaks in messages shown to users).
      expect(d.revertHint).toContain('Deposits screen');
      expect(d.revertHint).not.toContain('/api/');
    });

    it('refuses a Success deposit too', () => {
      const d = decideReversal({
        type: 'Deposit',
        status: 'Success',
        fundId: 'fund-1',
        amount: '100.00',
      });
      expect(d.requiresRevertPath).toBe(true);
    });

    it('allows deleting an unsettled deposit (never moved money)', () => {
      for (const status of ['Pending', 'Rejected', 'Request']) {
        const d = decideReversal({ type: 'Deposit', status, fundId: 'fund-1', amount: '100.00' });
        expect(d.requiresRevertPath).toBe(false);
        expect(d.direction).toBe(0);
      }
    });
  });

  describe('expenses credit the fund back', () => {
    it('returns +1 for a settled expense', () => {
      const d = decideReversal({
        type: 'Expense',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '321.00',
      });
      expect(d).toMatchObject({ fundId: 'fund-1', direction: 1, requiresRevertPath: false });
    });

    it('does nothing for a pending expense', () => {
      const d = decideReversal({
        type: 'Expense',
        status: 'Pending',
        fundId: 'fund-1',
        amount: '321.00',
      });
      expect(d.direction).toBe(0);
      expect(d.fundId).toBeNull();
    });
  });

  describe('fund transfers reverse in the correct direction', () => {
    it('Transfer Out credits the source fund back (+1)', () => {
      const d = decideReversal({
        type: 'Transfer Out',
        status: 'Completed',
        fundId: 'source',
        amount: '500.00',
      });
      expect(d).toMatchObject({ fundId: 'source', direction: 1 });
    });

    it('Transfer In debits the target fund back (-1)', () => {
      const d = decideReversal({
        type: 'Transfer In',
        status: 'Completed',
        fundId: 'target',
        amount: '500.00',
      });
      expect(d).toMatchObject({ fundId: 'target', direction: -1 });
    });
  });

  describe('#108: inflow/outflow types reverse via the canonical classifier', () => {
    it('a settled Earning debits the fund back (-1) — was stranded +amount before', () => {
      const d = decideReversal({
        type: 'Earning',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '1.00',
      });
      expect(d).toMatchObject({ fundId: 'fund-1', direction: -1, requiresRevertPath: false });
    });

    it('a settled Withdrawal credits the fund back (+1)', () => {
      const d = decideReversal({
        type: 'Withdrawal',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '50.00',
      });
      expect(d).toMatchObject({ fundId: 'fund-1', direction: 1 });
    });

    it('a settled Dividend credits the fund back (+1)', () => {
      const d = decideReversal({
        type: 'Dividend',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '50.00',
      });
      expect(d).toMatchObject({ fundId: 'fund-1', direction: 1 });
    });

    it('a settled Investment debits the fund back (-1)', () => {
      const d = decideReversal({
        type: 'Investment',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '50.00',
      });
      expect(d).toMatchObject({ fundId: 'fund-1', direction: -1 });
    });

    it('a 0/0 informational aggregate (Dividend Distribution) is left alone', () => {
      const d = decideReversal({
        type: 'Dividend Distribution',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '50.00',
      });
      expect(d).toMatchObject({ fundId: null, direction: 0 });
    });
  });

  describe('guard rails', () => {
    it('does nothing without a fund', () => {
      const d = decideReversal({
        type: 'Expense',
        status: 'Completed',
        fundId: null,
        amount: '321.00',
      });
      expect(d.direction).toBe(0);
      expect(d.fundId).toBeNull();
    });

    it('does nothing for an unknown type rather than guessing', () => {
      const d = decideReversal({
        type: 'SomethingNew',
        status: 'Completed',
        fundId: 'fund-1',
        amount: '10.00',
      });
      expect(d.direction).toBe(0);
    });

    it('treats a missing/null status as unsettled', () => {
      expect(decideReversal({ type: 'Expense', status: null, fundId: 'f', amount: '1' }).direction).toBe(0);
      expect(decideReversal({ type: 'Expense', status: undefined, fundId: 'f', amount: '1' }).direction).toBe(0);
    });
  });
});

describe('shouldRefundProjectExpenses', () => {
  it('is true only for settled expenses', () => {
    expect(
      shouldRefundProjectExpenses({ type: 'Expense', status: 'Completed', fundId: 'f', amount: '1' }),
    ).toBe(true);
    expect(
      shouldRefundProjectExpenses({ type: 'Expense', status: 'Success', fundId: 'f', amount: '1' }),
    ).toBe(true);
    expect(
      shouldRefundProjectExpenses({ type: 'Expense', status: 'Pending', fundId: 'f', amount: '1' }),
    ).toBe(false);
    expect(
      shouldRefundProjectExpenses({ type: 'Transfer Out', status: 'Completed', fundId: 'f', amount: '1' }),
    ).toBe(false);
  });
});

describe('shouldRefundProjectEarnings (#108b)', () => {
  it('is true only for settled earnings', () => {
    expect(
      shouldRefundProjectEarnings({ type: 'Earning', status: 'Completed', fundId: 'f', amount: '1' }),
    ).toBe(true);
    expect(
      shouldRefundProjectEarnings({ type: 'Earning', status: 'Success', fundId: 'f', amount: '1' }),
    ).toBe(true);
    expect(
      shouldRefundProjectEarnings({ type: 'Earning', status: 'Pending', fundId: 'f', amount: '1' }),
    ).toBe(false);
    expect(
      shouldRefundProjectEarnings({ type: 'Expense', status: 'Completed', fundId: 'f', amount: '1' }),
    ).toBe(false);
    expect(
      shouldRefundProjectEarnings({ type: 'Deposit', status: 'Completed', fundId: 'f', amount: '1' }),
    ).toBe(false);
  });
});
