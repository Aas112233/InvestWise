import { describe, expect, it } from 'vitest';
import {
  computeDepositEditDelta,
  findEquityViolation,
  findFundDeficitViolation,
  fundBalanceAcrossEdit,
  fundFloorCents,
  isUnchangedDepositDate,
  type FundBalanceSnapshot,
  type MemberEquitySnapshot,
} from '@/lib/deposit-edit-delta';

const FUND_A = '5e3df880-4ddb-4452-a963-a41677f186d1';
const FUND_B = '24fe3980-44b8-4c42-8af2-6d4183894d9e';
const MEMBER_A = 'edcbe3e6-96b2-462d-b301-a565e58a9022';
const MEMBER_B = '44e221a3-b77b-45ee-ae12-31fc7e4c9c0f';

function fund(id: string, balanceCents: number, minimumBalanceCents = 0): FundBalanceSnapshot {
  return { id, name: `Fund ${id.slice(0, 4)}`, balanceCents, minimumBalanceCents };
}

function member(id: string, equityCents: number): MemberEquitySnapshot {
  return { id, name: `Member ${id.slice(0, 4)}`, equityCents };
}

describe('deposit edit net delta', () => {
  it('is zero when the amount, fund and member all stay the same', () => {
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(0);
    expect(memberDelta.get(MEMBER_A)).toBe(0);
  });

  it('never dips the fund below zero on the way to its final balance', () => {
    // The regression: debiting the old amount and crediting the new one as
    // two UPDATEs drives the fund to -5000 and trips the DB's
    // `funds_balance_check CHECK (balance >= 0)`.
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    // The fund holds 0 (a dividend run paid it out). One net delta of 0
    // leaves it at 0 — the balance never goes negative at any point.
    const funds = new Map([[FUND_A, fund(FUND_A, 0)]]);
    expect(findFundDeficitViolation(fundDelta, funds)).toBeNull();
  });

  it('credits only the difference when the amount grows', () => {
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 800_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(300_000);
    expect(memberDelta.get(MEMBER_A)).toBe(300_000);
  });

  it('debits only the difference when the amount shrinks', () => {
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 800_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(-300_000);
    expect(memberDelta.get(MEMBER_A)).toBe(-300_000);
  });

  it('moves money between funds when the deposit is reassigned', () => {
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_B, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(-500_000);
    expect(fundDelta.get(FUND_B)).toBe(500_000);
  });

  it('moves equity between members when the deposit is reassigned', () => {
    const { memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_B, newAmountCents: 500_000 },
    );
    expect(memberDelta.get(MEMBER_A)).toBe(-500_000);
    expect(memberDelta.get(MEMBER_B)).toBe(500_000);
  });

  it('credits without debiting when a pending deposit is settled', () => {
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      { wasCompleted: false, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(500_000);
    expect(memberDelta.get(MEMBER_A)).toBe(500_000);
  });

  it('debits without crediting when a settled deposit is un-settled', () => {
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 500_000 },
      { isNowCompleted: false, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    expect(fundDelta.get(FUND_A)).toBe(-500_000);
    expect(memberDelta.get(MEMBER_A)).toBe(-500_000);
  });
});

describe('deposit edit guards', () => {
  it('refuses a debit that would overdraw a fund', () => {
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 800_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 200_000 },
    );
    // The fund only holds 3000 — debiting 6000 would leave it negative.
    const violation = findFundDeficitViolation(fundDelta, new Map([[FUND_A, fund(FUND_A, 300_000)]]));
    expect(violation).not.toBeNull();
    expect(violation?.fundId).toBe(FUND_A);
    expect(violation?.afterCents).toBe(-300_000);
  });

  it('allows a debit that lands exactly on the floor', () => {
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 800_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 500_000 },
    );
    // The fund holds 3000 and is debited 3000 -> lands on 0, which is legal.
    expect(findFundDeficitViolation(fundDelta, new Map([[FUND_A, fund(FUND_A, 300_000)]]))).toBeNull();
  });

  it('honours a fund minimum balance above zero', () => {
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 800_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 200_000 },
    );
    const funds = new Map([[FUND_A, fund(FUND_A, 300_000, 100_000)]]);
    const violation = findFundDeficitViolation(fundDelta, funds);
    expect(violation).not.toBeNull();
    expect(violation?.floorCents).toBe(100_000);
  });

  it('never refuses a credit', () => {
    const { fundDelta } = computeDepositEditDelta(
      { wasCompleted: false, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 0 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 900_000 },
    );
    expect(findFundDeficitViolation(fundDelta, new Map([[FUND_A, fund(FUND_A, 0)]]))).toBeNull();
  });

  it('refuses a debit that would push a member equity negative', () => {
    const { memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 900_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 100_000 },
    );
    // The member contributed 5000 in total but 4000 of it is invested.
    const violation = findEquityViolation(memberDelta, new Map([[MEMBER_A, member(MEMBER_A, 500_000)]]));
    expect(violation).not.toBeNull();
    expect(violation?.memberId).toBe(MEMBER_A);
    expect(violation?.afterCents).toBe(-300_000);
  });

  it('allows a debit that lands exactly on zero equity', () => {
    const { memberDelta } = computeDepositEditDelta(
      { wasCompleted: true, oldFundId: FUND_A, oldMemberId: MEMBER_A, oldAmountCents: 900_000 },
      { isNowCompleted: true, newFundId: FUND_A, newMemberId: MEMBER_A, newAmountCents: 400_000 },
    );
    expect(findEquityViolation(memberDelta, new Map([[MEMBER_A, member(MEMBER_A, 500_000)]]))).toBeNull();
  });
});

describe('fund balance across an edit', () => {
  it('reports the balance the fund held before and after the edit', () => {
    // The fund holds 0 and the edit credits 3000: before 0, after 3000.
    expect(fundBalanceAcrossEdit(300_000, 300_000)).toEqual({ beforeCents: 0, afterCents: 300_000 });
  });

  it('never prints a negative "before" balance for an untouched fund', () => {
    // The fund holds 0 and the edit changes nothing: before 0, after 0.
    expect(fundBalanceAcrossEdit(0, 0)).toEqual({ beforeCents: 0, afterCents: 0 });
  });

  it('reports the balance a fund held before it was debited', () => {
    expect(fundBalanceAcrossEdit(0, -300_000)).toEqual({ beforeCents: 300_000, afterCents: 0 });
  });
});

describe('fund floor', () => {
  it('is never negative', () => {
    expect(fundFloorCents(-500)).toBe(0);
  });

  it('is the minimum balance when it is positive', () => {
    expect(fundFloorCents(100_000)).toBe(100_000);
  });
});

describe('preserving the stored date', () => {
  it('recognises an edit that sends back the row’s own date', () => {
    // The row was booked ahead for a future month, so its stored date is
    // already in the future. Sending it back preserves it.
    expect(isUnchangedDepositDate('2026-12-01', '2026-12-01T00:00:00.000Z')).toBe(true);
    expect(isUnchangedDepositDate('2026-12-01', new Date('2026-12-01T00:00:00.000Z'))).toBe(true);
  });

  it('does not treat a different date as unchanged', () => {
    expect(isUnchangedDepositDate('2026-12-02', '2026-12-01T00:00:00.000Z')).toBe(false);
    expect(isUnchangedDepositDate('2026-10-01', '2026-12-01T00:00:00.000Z')).toBe(false);
  });

  it('is false for a missing or unparseable value', () => {
    expect(isUnchangedDepositDate(null, '2026-12-01')).toBe(false);
    expect(isUnchangedDepositDate('2026-12-01', null)).toBe(false);
    expect(isUnchangedDepositDate('2026-12-01', undefined)).toBe(false);
    expect(isUnchangedDepositDate('not-a-date', '2026-12-01')).toBe(false);
  });
});
