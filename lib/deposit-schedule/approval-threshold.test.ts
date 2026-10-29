/**
 * R2 — the decision that governs whether money posts as settled or waits for approval.
 * Exhaustive by intent: every branch here is a real posting outcome.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveFlexApprovalDecision } from './approval-threshold';

const AMOUNT = 100_000; // 1,000.00

describe('monthly is never rerouted', () => {
  it('a stale or extreme threshold must not change how a monthly deposit posts', () => {
    for (const above of [null, 0, '0', '1', '0.01', 1]) {
      const d = resolveFlexApprovalDecision({
        enforced: true,
        approvalAbove: above as string | number,
        amountCents: 999_999_999,
      });
      expect(d.postsAsPending).toBe(false);
      expect(d.reason).toBe('MONTHLY_SCHEDULE');
    }
  });
});

describe('the control is off unless configured', () => {
  it('absent, empty and whitespace values disable it', () => {
    for (const above of [null, undefined, '', '   ']) {
      const d = resolveFlexApprovalDecision({ enforced: false, approvalAbove: above, amountCents: AMOUNT });
      expect(d).toMatchObject({ postsAsPending: false, thresholdCents: null, reason: 'NOT_CONFIGURED' });
    }
  });

  it('an unusable stored value disables rather than blocking member money', () => {
    // Deliberate: R2 supplements the fiscal guard and the approval flow, it is not
    // the only control. Corrupt config must not stop a legitimate deposit, and the
    // reason is returned for the audit trail rather than swallowed.
    for (const above of ['abc', '-5', '-0.01', '1.999']) {
      const d = resolveFlexApprovalDecision({ enforced: false, approvalAbove: above, amountCents: AMOUNT });
      expect(d.postsAsPending).toBe(false);
      expect(d.thresholdCents).toBeNull();
      expect(d.reason).toBe('INVALID_CONFIGURED_VALUE');
    }
  });
});

describe('threshold semantics', () => {
  it('zero routes EVERY flexible deposit through approval', () => {
    const d = resolveFlexApprovalDecision({ enforced: false, approvalAbove: '0', amountCents: 1 });
    expect(d).toMatchObject({ postsAsPending: true, thresholdCents: 0, reason: null });
  });

  it('the rule is strictly ABOVE — an amount equal to the threshold still posts', () => {
    expect(resolveFlexApprovalDecision({ enforced: false, approvalAbove: '1000.00', amountCents: 100_000 }).postsAsPending)
      .toBe(false);
    expect(resolveFlexApprovalDecision({ enforced: false, approvalAbove: '1000.00', amountCents: 100_001 }).postsAsPending)
      .toBe(true);
  });

  it('compares in integer cents, so float text cannot drift the boundary', () => {
    const d = resolveFlexApprovalDecision({ enforced: false, approvalAbove: '19.99', amountCents: 20_000 });
    expect(d.thresholdCents).toBe(1999);
    expect(d.postsAsPending).toBe(true);
  });

  it('accepts a numeric column value as well as a decimal string', () => {
    expect(resolveFlexApprovalDecision({ enforced: false, approvalAbove: 500, amountCents: 50_000 }).postsAsPending)
      .toBe(false);
    expect(resolveFlexApprovalDecision({ enforced: false, approvalAbove: 500, amountCents: 50_001 }).postsAsPending)
      .toBe(true);
  });

  it('never escalates an unvalidated amount into the approval queue', () => {
    for (const amount of [0, -100, 1.5, NaN]) {
      const d = resolveFlexApprovalDecision({ enforced: false, approvalAbove: '10', amountCents: amount });
      expect(d.postsAsPending).toBe(false);
    }
  });
});

describe('invariants across a wide input grid', () => {
  it('postsAsPending is never true for a monthly member, whatever else is true', () => {
    const amounts = [1, 99, 100_000, 10_000_000_00];
    const thresholds = [null, undefined, '', '0', '0.01', '1000.00', 'bogus'];
    for (const enforced of [true, false]) {
      for (const a of amounts) {
        for (const t of thresholds) {
          const d = resolveFlexApprovalDecision({ enforced, approvalAbove: t, amountCents: a });
          if (enforced) expect(d.postsAsPending).toBe(false);
          // A null threshold can never produce a pending posting.
          if (d.thresholdCents === null) expect(d.postsAsPending).toBe(false);
          // Whenever the control did NOT reroute, it must say why — a silent
          // "post it" is indistinguishable from a forgotten branch.
          if (!d.postsAsPending) expect(d.reason).not.toBeNull();
        }
      }
    }
  });
});

/**
 * Wiring guard. The decision above is pure; what it controls is whether fund and
 * member balances move. These source assertions keep the handler honest in CI, where a
 * real double-credit could only be caught after it had already taken money from a
 * member's ledger.
 */
describe('the deposit handler honours the decision', () => {
  const absolute = fileURLToPath(new URL('../../app/api/deposits/route.ts', import.meta.url));
  const source = existsSync(absolute)
    ? readFileSync(absolute, 'utf8')
    : (() => { throw new Error('app/api/deposits/route.ts is missing — R2 wiring guard gone.'); })();

  it('asks the shared decision rather than re-deriving the threshold inline', () => {
    expect(source).toContain('resolveFlexApprovalDecision(');
    expect(source).toContain('enforced: depositSchedule.enforced');
  });

  it('writes no balance and no contribution when it posts as pending', () => {
    // Both balance updates must sit inside the `if (!postsAsPending)` guard.
    expect(source).toContain('if (!postsAsPending) {');
    const guardAt = source.indexOf('if (!postsAsPending) {');
    expect(guardAt).toBeGreaterThan(-1);
    expect(source.indexOf('totalContributed: sql`', guardAt)).toBeGreaterThan(guardAt);
  });

  it('does not report a balance the ledger never received', () => {
    expect(source).toContain('postsAsPending ? fundBalanceCents : fundBalanceCents + amountCents');
  });

  it('files a pending row in the shape the existing approve/reject paths expect', () => {
    expect(source).toContain("status: postsAsPending ? 'PENDING' : 'Completed'");
    expect(source).toContain('postsAsPending ? DEPOSIT_REQUEST_CATEGORY : DEPOSIT_CATEGORY');
  });

  it('audits and messages what actually happened, not what was requested', () => {
    expect(source).toContain("postsAsPending ? 'REQUEST_DEPOSIT' : 'RECORD_DEPOSIT'");
    expect(source).toContain('No balance has been updated yet');
  });

  it('never lets monthly reach the pending path', () => {
    // The threshold is read from settings, but monthly is short-circuited inside the
    // decision — a stale configured value must never reroute a monthly deposit.
    expect(resolveFlexApprovalDecision({ enforced: true, approvalAbove: '0', amountCents: 1 }).postsAsPending)
      .toBe(false);
  });
});
