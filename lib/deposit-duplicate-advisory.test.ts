/**
 * R1 — near-duplicate advisory. Pure parts plus the short-circuits.
 *
 * The advisory must never become a gate and never become noise: both failure modes
 * are tested here. The query itself needs a database; what is testable without one is
 * when it does NOT run and what it says when it does.
 */

import { describe, expect, it } from 'vitest';
import {
  findNearDuplicateDeposits,
  nearDuplicateAdvisory,
  nearDuplicateWindowBounds,
} from './deposit-duplicate-advisory';

const D = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe('nearDuplicateWindowBounds', () => {
  it('is symmetric around the collected date', () => {
    const b = nearDuplicateWindowBounds(D('2026-10-15T09:00:00Z'), 3)!;
    expect(b.from.toISOString()).toBe(new Date(D('2026-10-15T09:00:00Z').getTime() - 3 * DAY).toISOString());
    expect(b.to.toISOString()).toBe(new Date(D('2026-10-15T09:00:00Z').getTime() + 3 * DAY).toISOString());
  });

  it('is DISABLED for 0, negative, null, undefined, NaN and junk', () => {
    const d = D('2026-10-15T09:00:00Z');
    for (const w of [0, -1, -30, null, undefined, NaN, Infinity, 'abc']) {
      expect(nearDuplicateWindowBounds(d, w as unknown as number)).toBeNull();
    }
  });

  it('treats an unset setting as OFF, not as "warn on every deposit"', () => {
    // The important default direction: a missing column value must not produce a
    // warning on every single deposit, which would train officers to ignore it.
    expect(nearDuplicateWindowBounds(D('2026-10-15T09:00:00Z'), null)).toBeNull();
  });

  it('floors a fractional window', () => {
    const b = nearDuplicateWindowBounds(D('2026-10-15T00:00:00Z'), 3.9)!;
    expect(b.to.getTime() - D('2026-10-15T00:00:00Z').getTime()).toBe(3 * DAY);
  });
});

describe('findNearDuplicateDeposits short-circuits — advisory must not slow or fail a write', () => {
  const explosion = new Proxy({}, {
    get() { throw new Error('the advisory must not query when disabled or given junk input'); },
  });
  const base = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    memberId: '22222222-2222-4222-8222-222222222222',
    amountCents: 50_000,
    collectedDate: D('2026-10-15T09:00:00Z'),
  };

  it('window disabled ⇒ no query, no warning', async () => {
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: 0 })).resolves.toEqual([]);
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: null })).resolves.toEqual([]);
  });

  it('unusable input ⇒ no query rather than an unbounded scan', async () => {
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: 3, memberId: '' }))
      .resolves.toEqual([]);
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: 3, amountCents: 0 }))
      .resolves.toEqual([]);
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: 3, amountCents: -500 }))
      .resolves.toEqual([]);
    // Non-integer cents would compare against a canonical amount string that can never
    // exist; refuse rather than scan.
    await expect(findNearDuplicateDeposits(explosion, { ...base, windowDays: 3, amountCents: 500.5 }))
      .resolves.toEqual([]);
  });
});

describe('nearDuplicateAdvisory', () => {
  const match = (over: Record<string, unknown> = {}) => ({
    id: 'tx-1',
    referenceNumber: 'DEP-1',
    date: '2026-10-13T09:00:00Z',
    amount: '500.00',
    daysApart: 2,
    ...over,
  });

  it('says nothing when there is nothing to say', () => {
    expect(nearDuplicateAdvisory([])).toBeNull();
  });

  it('names the date, the reference and that the deposit was STILL recorded', () => {
    const msg = nearDuplicateAdvisory([match()])!;
    expect(msg).toContain('2026-10-13');
    expect(msg).toContain('DEP-1');
    // Wording matters: it must read as an advisory, not a rejection.
    expect(msg).toContain('Recorded anyway');
  });

  it('counts additional matches instead of hiding them', () => {
    const msg = nearDuplicateAdvisory([match(), match({ id: 'b' }), match({ id: 'c' })])!;
    expect(msg).toContain('2 more');
  });

  it('never uses the §11 validation-error shape, which the client renders as a failure', () => {
    const msg = nearDuplicateAdvisory([match()])!;
    expect(msg).not.toContain("Code:");
    expect(msg).not.toContain('[Field');
  });

  it('degrades when the matched row has no reference or date', () => {
    const msg = nearDuplicateAdvisory([match({ referenceNumber: null, date: null })])!;
    expect(msg).toContain('an earlier date');
    expect(msg).not.toContain('Ref:');
  });
});
