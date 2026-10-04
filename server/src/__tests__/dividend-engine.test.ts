import { describe, expect, it } from 'vitest';
import { computeDividendPlan, fromMicros } from '../modules/finance/dividend-engine.js';

/** Members helper: three holders of 30 shares each. */
const equalMembers = [
  { id: 'c', memberId: 'MEM-0003', name: 'C', shares: 30 },
  { id: 'a', memberId: 'MEM-0001', name: 'A', shares: 30 },
  { id: 'b', memberId: 'MEM-0002', name: 'B', shares: 30 },
];

describe('computeDividendPlan — statutory reserve split', () => {
  it('retains the reserve and distributes the remainder exactly', () => {
    const plan = computeDividendPlan({
      grossEarnings: '1000.00',
      statutoryReservePercent: '10',
      members: equalMembers,
    });

    expect(plan.grossAmount).toBe('1000.00');
    expect(plan.reserveAmount).toBe('100.00');
    expect(plan.netDistributable).toBe('900.00');
    // The books must balance before anything is written (§12).
    expect(plan.reserveCents + plan.netCents).toBe(plan.grossCents);
  });

  it('honors a zero reserve percent', () => {
    const plan = computeDividendPlan({
      grossEarnings: '500.50',
      statutoryReservePercent: '0',
      members: equalMembers,
    });
    expect(plan.reserveCents).toBe(0);
    expect(plan.netDistributable).toBe('500.50');
  });

  it('honors a full 100 percent reserve and pays nobody', () => {
    const plan = computeDividendPlan({
      grossEarnings: '500.50',
      statutoryReservePercent: '100',
      members: equalMembers,
    });
    expect(plan.reserveAmount).toBe('500.50');
    expect(plan.netCents).toBe(0);
    expect(plan.payouts.every((p) => p.payoutCents === 0)).toBe(true);
    expect(plan.recipientCount).toBe(0);
  });

  it('accepts a fractional percent and rounds the reserve half-up', () => {
    // 5 cents at 50% is 2.5 cents -> 3 retained, 2 distributed.
    const plan = computeDividendPlan({
      grossEarnings: '0.05',
      statutoryReservePercent: '50',
      members: equalMembers,
    });
    expect(plan.reserveCents).toBe(3);
    expect(plan.netCents).toBe(2);
  });

  it('rejects a percent outside 0-100 instead of retaining nonsense', () => {
    expect(() =>
      computeDividendPlan({ grossEarnings: '100.00', statutoryReservePercent: '150', members: equalMembers }),
    ).toThrow();
    expect(() =>
      computeDividendPlan({ grossEarnings: '100.00', statutoryReservePercent: '-1', members: equalMembers }),
    ).toThrow();
  });
});

describe('computeDividendPlan — share-weighted payouts', () => {
  it('sums to the net distributable when the amount does not divide evenly', () => {
    const plan = computeDividendPlan({
      // 100.00 across three 1-share members: 33.33 + 33.33 + 33.34
      grossEarnings: '100.00',
      statutoryReservePercent: '0',
      members: [
        { id: 'a', memberId: 'MEM-0001', name: 'A', shares: 1 },
        { id: 'b', memberId: 'MEM-0002', name: 'B', shares: 1 },
        { id: 'c', memberId: 'MEM-0003', name: 'C', shares: 1 },
      ],
    });

    expect(plan.payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(plan.netCents);
    expect(plan.totalDistributedCents).toBe(10_000);
    expect(plan.payouts.map((p) => p.grossAmount).sort()).toEqual(['33.33', '33.33', '33.34']);
  });

  it('is deterministic regardless of member input order', () => {
    const a = computeDividendPlan({ grossEarnings: '100.01', statutoryReservePercent: '0', members: equalMembers });
    const b = computeDividendPlan({
      grossEarnings: '100.01',
      statutoryReservePercent: '0',
      members: [...equalMembers].reverse(),
    });
    // Same ids get the same cents whichever order the roster arrived in.
    for (const key of ['a', 'b', 'c']) {
      expect(a.payouts.find((p) => p.id === key)!.payoutCents).toBe(
        b.payouts.find((p) => p.id === key)!.payoutCents,
      );
    }
  });

  it('weights payouts by shares', () => {
    const plan = computeDividendPlan({
      grossEarnings: '900.00',
      statutoryReservePercent: '0',
      members: [
        { id: 'a', memberId: 'MEM-0001', name: 'A', shares: 10 },
        { id: 'b', memberId: 'MEM-0002', name: 'B', shares: 20 },
      ],
    });
    expect(plan.payouts.find((p) => p.id === 'a')!.grossAmount).toBe('300.00');
    expect(plan.payouts.find((p) => p.id === 'b')!.grossAmount).toBe('600.00');
  });

  it('excludes zero-share members from the payout set', () => {
    const plan = computeDividendPlan({
      grossEarnings: '100.00',
      statutoryReservePercent: '0',
      members: [
        { id: 'a', memberId: 'MEM-0001', name: 'A', shares: 5 },
        { id: 'z', memberId: 'MEM-0009', name: 'Z', shares: 0 },
      ],
    });
    expect(plan.totalActiveShares).toBe(5);
    // Zero-share holders are excluded from the payout set entirely — they are
    // not paid, and they do not appear as zero rows in the preview.
    expect(plan.payouts.find((p) => p.id === 'z')).toBeUndefined();
    expect(plan.recipientCount).toBe(1);
    expect(plan.totalDistributedCents).toBe(10_000);
  });

  it('throws when nobody holds shares', () => {
    expect(() =>
      computeDividendPlan({
        grossEarnings: '100.00',
        statutoryReservePercent: '0',
        members: [{ id: 'z', memberId: 'MEM-0009', name: 'Z', shares: 0 }],
      }),
    ).toThrow();
  });
});

describe('computeDividendPlan — rates', () => {
  it('derives the run rate in exact 6dp without float drift', () => {
    const plan = computeDividendPlan({
      grossEarnings: '900.00',
      statutoryReservePercent: '0',
      members: equalMembers, // 90 shares total
    });
    expect(plan.ratePerShare).toBe('10.000000');
    expect(plan.payouts.find((p) => p.id === 'a')!.ratePerShare).toBe('10.000000');
  });

  it('keeps a repeating rate exact where float math would drift', () => {
    // 100.00 over 3 shares = 33.333333... per share
    const plan = computeDividendPlan({
      grossEarnings: '100.00',
      statutoryReservePercent: '0',
      members: [
        { id: 'a', memberId: 'MEM-0001', name: 'A', shares: 1 },
        { id: 'b', memberId: 'MEM-0002', name: 'B', shares: 1 },
        { id: 'c', memberId: 'MEM-0003', name: 'C', shares: 1 },
      ],
    });
    expect(plan.ratePerShare).toBe('33.333333');
    // (33.333333 * 3) is 99.999999, yet the payouts still total exactly 100.00:
    // the rate is informational and never the basis of a payment.
    expect(plan.totalDistributedCents).toBe(10_000);
  });

  it('formats micro units with a leading zero and no exponent', () => {
    expect(fromMicros(1)).toBe('0.000001');
    expect(fromMicros(0)).toBe('0.000000');
    expect(fromMicros(1_000_000)).toBe('1.000000');
  });
});

describe('computeDividendPlan — amount validation', () => {
  it('rejects a non-positive gross', () => {
    expect(() =>
      computeDividendPlan({ grossEarnings: '0.00', statutoryReservePercent: '10', members: equalMembers }),
    ).toThrow();
    expect(() =>
      computeDividendPlan({ grossEarnings: '-5.00', statutoryReservePercent: '10', members: equalMembers }),
    ).toThrow();
  });

  it('rejects more than two decimal places rather than rounding silently', () => {
    expect(() =>
      computeDividendPlan({ grossEarnings: '10.001', statutoryReservePercent: '10', members: equalMembers }),
    ).toThrow();
  });
});
