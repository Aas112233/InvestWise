/**
 * Phase 0 CHARACTERISATION LOCK — monthly deposit behaviour.
 *
 * These are GOLDEN tests with hand-computed literal expectations, deliberately NOT
 * `toMatchSnapshot()` of whatever the code happens to do today. They pin the monthly
 * contract BEFORE the flexible-deposit work so that "monthly stays 100% accurate"
 * is a verifiable claim instead of an assertion. See docs/DEPOSIT_SCHEDULE_DESIGN.md §9.
 *
 * Two rules for this file:
 *   1. If a value here changes, a monthly member's compliance changed. Stop and justify.
 *   2. `CURRENT BEHAVIOUR, NOT ENDORSED` blocks record real quirks on purpose. They are
 *      the diff-catcher if the flexible work perturbs them.
 *
 * Money is integer cents; all month math is UTC.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOVERNANCE_RULES,
  GOVERNANCE_RULE_BOUNDS,
  GovernanceRuleError,
  addMonthsToPeriodKey,
  allocateDepositsToPeriods,
  clampDayOfMonth,
  daysInMonth,
  evaluatePeriodDeposits,
  monthsBetweenPeriodKeys,
  monthsSincePeriodKey,
  normalizeGovernanceRules,
  parsePeriodKey,
  resolveDepositDeadline,
  resolveGraceEnd,
  resolveRequiredMonthlyCents,
  toPeriodKey,
} from './status-rules';

/** 1000.00 per share (DEFAULT_SHARE_VALUE_CENTS). */
const SHARE = 100_000;
/** A 1000.00 monthly obligation. */
const REQ = 100_000;
const RULES = { ...DEFAULT_GOVERNANCE_RULES };

const utc = (iso: string) => new Date(iso);

/**
 * `GovernanceRuleError` carries its machine code on `.code`, NOT in `.message`, so
 * `toThrow('CODE')` can never match. Capture and assert the real contract instead —
 * API consumers key on `code`.
 */
const captureRuleError = (fn: () => unknown): GovernanceRuleError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GovernanceRuleError) return e;
    throw e;
  }
  throw new Error('expected a GovernanceRuleError to be thrown, but nothing was');
};

describe('monthly deadline + grace window (golden)', () => {
  it('deadline is depositDueDate + gracePeriodDays, end-of-day UTC', () => {
    // 10 + 3 = 13 → October has 31 days, no clamp.
    expect(resolveDepositDeadline('2026-10', RULES)).toEqual(new Date(Date.UTC(2026, 9, 13, 23, 59, 59, 999)));
  });

  it('clamps the deadline to the month’s real last day instead of discarding grace', () => {
    // The legacy engine capped at day 28 and silently lost the buffer.
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(daysInMonth(2026, 2)).toBe(28); // 2026 is not a leap year
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(resolveDepositDeadline('2026-02', { depositDueDate: 28, gracePeriodDays: 3 }))
      .toEqual(new Date(Date.UTC(2026, 1, 28, 23, 59, 59, 999)));
    expect(resolveDepositDeadline('2028-02', { depositDueDate: 28, gracePeriodDays: 3 }))
      .toEqual(new Date(Date.UTC(2028, 1, 29, 23, 59, 59, 999)));
  });

  it('grace end is the end of the period plus lateDepositGraceMonths whole months', () => {
    // 2026-10 + 1 → settles through the whole of November.
    expect(resolveGraceEnd('2026-10', RULES)).toEqual(new Date(Date.UTC(2026, 10, 30, 23, 59, 59, 999)));
    // Zero grace: the month itself is the limit.
    expect(resolveGraceEnd('2026-10', { lateDepositGraceMonths: 0 }))
      .toEqual(new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999)));
    // Year rollover.
    expect(resolveGraceEnd('2026-12', RULES)).toEqual(new Date(Date.UTC(2027, 0, 31, 23, 59, 59, 999)));
  });

  it('period-key math crosses year boundaries correctly', () => {
    expect(addMonthsToPeriodKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToPeriodKey('2027-01', -1)).toBe('2026-12');
    expect(addMonthsToPeriodKey('2026-01', -12)).toBe('2025-01');
    expect(monthsBetweenPeriodKeys('2026-01', '2026-10')).toBe(9);
    expect(monthsSincePeriodKey('2026-05', utc('2026-10-31T23:00:00Z'))).toBe(5);
    // Floored at zero, never negative.
    expect(monthsSincePeriodKey('2026-11', utc('2026-10-01T00:00:00Z'))).toBe(0);
    expect(toPeriodKey(utc('2026-10-31T23:59:59.999Z'))).toBe('2026-10');
  });
});

describe('monthly compliance ladder (golden)', () => {
  const period = '2026-10';
  // deadline 2026-10-13, grace end 2026-11-30.
  const shape = (over: Record<string, unknown> = {}) => ({
    periodKey: period,
    requiredCents: REQ,
    compliance: expect.any(String),
    deadline: new Date(Date.UTC(2026, 9, 13, 23, 59, 59, 999)),
    graceEnd: new Date(Date.UTC(2026, 10, 30, 23, 59, 59, 999)),
    ...over,
  });

  it('MISSED — no deposit at all, shortfall is the whole obligation', () => {
    expect(evaluatePeriodDeposits(period, [], REQ, RULES)).toEqual(
      shape({ depositedCents: 0, shortfallCents: REQ, qualifyingDate: null, depositCount: 0, compliance: 'MISSED' }),
    );
  });

  it('ON_TIME — target met on the due date itself', () => {
    const d = utc('2026-10-13T10:00:00Z');
    expect(evaluatePeriodDeposits(period, [{ date: d, amountCents: REQ }], REQ, RULES)).toEqual(
      shape({ depositedCents: REQ, shortfallCents: 0, qualifyingDate: d, depositCount: 1, compliance: 'ON_TIME' }),
    );
  });

  it('ON_TIME — grace protects TIMELINESS: full amount after the deadline but inside grace', () => {
    // Past the 13th-day deadline, inside the 30-Nov grace end.
    const d = utc('2026-11-20T00:00:00Z');
    const r = evaluatePeriodDeposits(period, [{ date: d, amountCents: REQ }], REQ, RULES);
    expect(r.compliance).toBe('ON_TIME');
    expect(r.shortfallCents).toBe(0);
    expect(r.qualifyingDate).toEqual(d);
  });

  it('LATE — full amount outside grace still SETTLES the month (shortfall 0)', () => {
    const d = utc('2026-12-15T00:00:00Z');
    const r = evaluatePeriodDeposits(period, [{ date: d, amountCents: REQ }], REQ, RULES);
    expect(r.compliance).toBe('LATE');
    expect(r.shortfallCents).toBe(0);
  });

  it('PARTIAL — grace does NOT protect amount: inside grace but under target', () => {
    const r = evaluatePeriodDeposits(period, [{ date: utc('2026-10-05T00:00:00Z'), amountCents: 40_000 }], REQ, RULES);
    expect(r.compliance).toBe('PARTIAL');
    expect(r.depositedCents).toBe(40_000);
    expect(r.shortfallCents).toBe(60_000);
    expect(r.qualifyingDate).toBeNull();
  });

  it('qualifyingDate is the leg where the CUMULATIVE total first reaches target', () => {
    const legs = [
      { date: utc('2026-10-01T00:00:00Z'), amountCents: 30_000 },
      { date: utc('2026-10-20T00:00:00Z'), amountCents: 70_000 },
      { date: utc('2026-10-25T00:00:00Z'), amountCents: 5_000 },
    ];
    const r = evaluatePeriodDeposits(period, legs, REQ, RULES);
    expect(r.depositedCents).toBe(105_000);
    expect(r.shortfallCents).toBe(0);
    expect(r.qualifyingDate).toEqual(utc('2026-10-20T00:00:00Z'));
    expect(r.depositCount).toBe(3);
  });

  it('unsorted input is handled — legs are ordered by date internally', () => {
    const ascending = evaluatePeriodDeposits(
      period,
      [{ date: utc('2026-10-01T00:00:00Z'), amountCents: 30_000 }, { date: utc('2026-10-20T00:00:00Z'), amountCents: 70_000 }],
      REQ, RULES,
    );
    const descending = evaluatePeriodDeposits(
      period,
      [{ date: utc('2026-10-20T00:00:00Z'), amountCents: 70_000 }, { date: utc('2026-10-01T00:00:00Z'), amountCents: 30_000 }],
      REQ, RULES,
    );
    expect(descending).toEqual(ascending);
    expect(ascending.qualifyingDate).toEqual(utc('2026-10-20T00:00:00Z'));
  });

  it('CURRENT BEHAVIOUR, NOT ENDORSED — zero obligation + a payment grades LATE', () => {
    // resolveRequiredMonthlyCents floors at one share, so 0 obligation is unreachable
    // in production today. Pinned because a flexible period target would make it
    // reachable; the ladder must not call a compliant member late.
    const r = evaluatePeriodDeposits(period, [{ date: utc('2026-10-05T00:00:00Z'), amountCents: 50_000 }], 0, RULES);
    expect(r.compliance).toBe('LATE');
    expect(r.shortfallCents).toBe(0);
  });

  it('CURRENT BEHAVIOUR, NOT ENDORSED — zero obligation + no payment grades MISSED', () => {
    const r = evaluatePeriodDeposits(period, [], 0, RULES);
    expect(r.compliance).toBe('MISSED');
    expect(r.shortfallCents).toBe(0);
  });

  it('rejects non-integer money and invalid dates instead of guessing', () => {
    expect(captureRuleError(() => evaluatePeriodDeposits(period, [], 10_000.5, RULES)).code).toBe('INVALID_REQUIRED');
    expect(captureRuleError(() => evaluatePeriodDeposits(period, [{ date: utc('2026-10-01T00:00:00Z'), amountCents: 10.5 }], REQ, RULES)).code).toBe('INVALID_LEG');
    expect(captureRuleError(() => evaluatePeriodDeposits(period, [{ date: new Date('nope'), amountCents: 100 }], REQ, RULES)).code).toBe('INVALID_DATE');
  });
});

describe('deposit → period attribution waterfall (golden)', () => {
  const req3 = () => ([
    { periodKey: '2026-08', requiredCents: 50_000 },
    { periodKey: '2026-09', requiredCents: 50_000 },
    { periodKey: '2026-10', requiredCents: 50_000 },
  ]);

  it('one payment settles the earliest eligible periods and cascades forward', () => {
    const { allocations, unallocatedCents, unallocatedLegCount } = allocateDepositsToPeriods(
      [{ date: utc('2026-09-10T00:00:00Z'), amountCents: 120_000 }], req3(), 1,
    );
    expect(allocations.map(a => [a.periodKey, a.allocatedCents, a.shortfallCents])).toEqual([
      ['2026-08', 50_000, 0],
      ['2026-09', 50_000, 0],
      ['2026-10', 0, 50_000],
    ]);
    expect(unallocatedCents).toBe(20_000);
    expect(unallocatedLegCount).toBe(1);
  });

  it('graceMonths = 1 reaches back EXACTLY one month — no further', () => {
    // A September payment may settle September and August, and never July.
    const { allocations, unallocatedCents } = allocateDepositsToPeriods(
      [{ date: utc('2026-09-10T00:00:00Z'), amountCents: 150_000 }],
      [
        { periodKey: '2026-07', requiredCents: 50_000 },
        { periodKey: '2026-08', requiredCents: 50_000 },
        { periodKey: '2026-09', requiredCents: 50_000 },
      ], 1,
    );
    expect(allocations.map(a => [a.periodKey, a.allocatedCents, a.shortfallCents])).toEqual([
      ['2026-07', 0, 50_000],     // out of reach: permanently owed
      ['2026-08', 50_000, 0],     // the one-month reach-back
      ['2026-09', 50_000, 0],     // its own month
    ]);
    expect(unallocatedCents).toBe(50_000); // cannot prepay October
  });

  it('graceMonths = 0 means a payment only ever settles its own month', () => {
    const { allocations } = allocateDepositsToPeriods(
      [{ date: utc('2026-09-05T00:00:00Z'), amountCents: 50_000 }], req3(), 0,
    );
    expect(allocations.map(a => [a.periodKey, a.shortfallCents])).toEqual([
      ['2026-08', 50_000], ['2026-09', 0], ['2026-10', 50_000],
    ]);
  });

  it('money is NEVER pushed forward into a future period', () => {
    const { allocations, unallocatedCents } = allocateDepositsToPeriods(
      [{ date: utc('2026-08-10T00:00:00Z'), amountCents: 150_000 }], req3(), 1,
    );
    expect(allocations.map(a => [a.periodKey, a.allocatedCents])).toEqual([
      ['2026-08', 50_000], ['2026-09', 0], ['2026-10', 0],
    ]);
    expect(unallocatedCents).toBe(100_000);
  });

  it('splits at cent precision across two periods', () => {
    const { allocations } = allocateDepositsToPeriods(
      [{ date: utc('2026-09-05T00:00:00Z'), amountCents: 75_050 }],
      [{ periodKey: '2026-08', requiredCents: 50_000 }, { periodKey: '2026-09', requiredCents: 50_000 }], 1,
    );
    expect(allocations.map(a => [a.periodKey, a.allocatedCents, a.shortfallCents])).toEqual([
      ['2026-08', 50_000, 0], ['2026-09', 25_050, 24_950],
    ]);
  });

  it('legs are consumed oldest-first', () => {
    const { allocations } = allocateDepositsToPeriods(
      [
        { date: utc('2026-09-30T00:00:00Z'), amountCents: 50_000 },
        { date: utc('2026-09-01T00:00:00Z'), amountCents: 10_000 },
      ],
      [{ periodKey: '2026-09', requiredCents: 60_000 }], 0,
    );
    const first = allocations.at(0);
    expect(first?.allocatedCents).toBe(60_000);
    expect(first?.legs.map(l => l.date.toISOString())).toEqual([
      '2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z',
    ]);
  });

  it('§12 — nothing is swallowed: no in-scope period returns every cent as unallocated', () => {
    const r = allocateDepositsToPeriods(
      [
        { date: utc('2026-09-01T00:00:00Z'), amountCents: 40_000 },
        { date: utc('2026-09-02T00:00:00Z'), amountCents: 60_000 },
      ], [], 1,
    );
    expect(r.allocations).toEqual([]);
    expect(r.unallocatedCents).toBe(100_000);
    expect(r.unallocatedLegCount).toBe(2);
  });

  it('rejects malformed input loudly — machine code AND message', () => {
    const leg = [{ date: utc('2026-09-01T00:00:00Z'), amountCents: 100 }];
    expect(captureRuleError(() => allocateDepositsToPeriods(leg, req3(), -1)).code).toBe('INVALID_GRACE_MONTHS');
    expect(captureRuleError(() => allocateDepositsToPeriods(leg, [{ periodKey: '2026-13', requiredCents: 1 }], 1)).code).toBe('INVALID_PERIOD_KEY');
    expect(captureRuleError(() => allocateDepositsToPeriods(leg, [{ periodKey: '2026-08', requiredCents: -1 }], 1)).code).toBe('INVALID_REQUIRED');
    expect(captureRuleError(() => allocateDepositsToPeriods([{ date: utc('2026-09-01T00:00:00Z'), amountCents: -1 }], req3(), 1)).code).toBe('INVALID_LEG');
    // The messages are operator-facing prose; pin one so the wording is not accidental.
    expect(captureRuleError(() => allocateDepositsToPeriods(leg, req3(), -1)).message)
      .toBe('graceMonths must be a non-negative integer');
  });
});

describe('monthly obligation resolution (golden)', () => {
  it('an explicit positive target always wins over shares', () => {
    expect(resolveRequiredMonthlyCents({ shares: 3, monthlyDepositTarget: '1500.00' }, SHARE)).toBe(150_000);
  });

  it('falls back to shares × share value', () => {
    expect(resolveRequiredMonthlyCents({ shares: 3, monthlyDepositTarget: null }, SHARE)).toBe(300_000);
    expect(resolveRequiredMonthlyCents({ shares: 1, monthlyDepositTarget: undefined }, 4_000)).toBe(4_000);
  });

  it('a zero/blank target is not a positive amount — it falls back, it does not zero out', () => {
    expect(resolveRequiredMonthlyCents({ shares: 2, monthlyDepositTarget: '0' }, SHARE)).toBe(200_000);
    expect(resolveRequiredMonthlyCents({ shares: 2, monthlyDepositTarget: '' }, SHARE)).toBe(200_000);
  });

  it('floors at ONE share so a 0-share member still carries an obligation', () => {
    expect(resolveRequiredMonthlyCents({ shares: 0, monthlyDepositTarget: null }, SHARE)).toBe(100_000);
    expect(resolveRequiredMonthlyCents({ shares: null, monthlyDepositTarget: null }, SHARE)).toBe(100_000);
  });
});

describe('governance rule normalisation (golden)', () => {
  it('defaults land on the documented values and bounds', () => {
    expect(normalizeGovernanceRules(null)).toEqual({
      depositDueDate: 10, gracePeriodDays: 3, lateDepositGraceMonths: 1,
      inactiveAfterMonths: 3, suspendedAfterMonths: 6,
    });
    expect(GOVERNANCE_RULE_BOUNDS.depositDueDate).toEqual({ min: 1, max: 28 });
  });

  it('a corrupt value THROWS rather than silently clamping a tenant’s governance', () => {
    expect(captureRuleError(() => normalizeGovernanceRules({ depositDueDate: 29 })).code).toBe('OUT_OF_RANGE');
    expect(captureRuleError(() => normalizeGovernanceRules({ depositDueDate: 1.5 })).code).toBe('NOT_AN_INTEGER');
    expect(captureRuleError(() => normalizeGovernanceRules({ suspendedAfterMonths: 3, inactiveAfterMonths: 3 })).code).toBe('INVALID_THRESHOLD_ORDER');
  });

  it('nullish fields fall back per-field instead of poisoning the whole row', () => {
    // `undefined` is the typed path. A real `null` is NOT in the declared signature but IS
    // handled by readBound — pinned deliberately, because settings rows arrive from Postgres
    // with genuine NULLs and must not take the nightly sweep down.
    expect(normalizeGovernanceRules({ gracePeriodDays: undefined }).gracePeriodDays).toBe(3);
    expect(normalizeGovernanceRules({ depositDueDate: null as unknown as number }).depositDueDate).toBe(10);
  });

  it('parsePeriodKey refuses an impossible month', () => {
    expect(parsePeriodKey('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(() => parsePeriodKey('2026-13')).toThrow(GovernanceRuleError);
    expect(() => toPeriodKey(new Date('nope'))).toThrow('Invalid date');
  });
});
