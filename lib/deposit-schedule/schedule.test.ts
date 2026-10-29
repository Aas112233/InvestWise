/**
 * Phase 1 — deposit schedule policy.
 *
 * The important test here is `resolveDepositScheduleDetailed`, and specifically the case that
 * a naive precedence rule gets wrong: every legacy `members` row carries `deposit_frequency =
 * 'monthly'` (it is the column default, and all four seed scripts hardcode it). If a
 * member-level value took precedence over the tenant setting, switching an existing tenant to
 * flexible would change NOTHING and the feature would look silently broken.
 *
 * `legacyIsMonthlySchedule` below is the previous implementation copied verbatim. Proving the
 * port byte-equivalent is what makes Phase 1 a no-op for every live monthly tenant
 * (docs/DEPOSIT_SCHEDULE_DESIGN.md §9 Gate 1).
 */

import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_SCHEDULE,
  isDepositObligationEnforced,
  isMonthlyDepositFrequency,
  normalizeDepositSchedule,
  resolveDepositSchedule,
  resolveDepositScheduleDetailed,
} from './schedule';

/** Verbatim from lib/governance/status-service.ts before the vocabulary moved here. */
const MONTHLY_FREQUENCIES = new Set(['monthly', 'month', '1']);
function legacyIsMonthlySchedule(depositFrequency: string | null | undefined): boolean {
  if (!depositFrequency) return true;
  return MONTHLY_FREQUENCIES.has(String(depositFrequency).trim().toLowerCase());
}

describe('isMonthlyDepositFrequency — byte-equivalent port', () => {
  const cases: Array<string | null | undefined> = [
    'monthly', 'month', '1', 'MONTH', ' Month ', 'monthly ',
    'quarterly', 'weekly', 'ad-hoc', 'ad_hoc', 'flexible', 'annual', '0', '2',
    '', ' ', '  ', 'null', 'undefined', 'N',
    null, undefined,
  ];

  it.each(cases.map(String))('matches the legacy rule for %j', (raw) => {
    const value = raw === 'undefined' ? undefined : raw === 'null' ? null : raw;
    expect(isMonthlyDepositFrequency(value)).toBe(legacyIsMonthlySchedule(value));
  });

  it('treats absent and empty-string frequency as monthly (the falsy branch of the original)', () => {
    expect(isMonthlyDepositFrequency(null)).toBe(true);
    expect(isMonthlyDepositFrequency(undefined)).toBe(true);
    expect(isMonthlyDepositFrequency('')).toBe(true);
  });

  it('treats a custom cadence as NOT monthly, which is the pre-existing per-member exemption', () => {
    for (const v of ['quarterly', 'weekly', 'ad-hoc', 'flexible', 'annual']) {
      expect(isMonthlyDepositFrequency(v)).toBe(false);
    }
  });
});

describe('normalizeDepositSchedule — fails closed to monthly', () => {
  it('accepts the two known values', () => {
    expect(normalizeDepositSchedule('monthly').schedule).toBe(DEPOSIT_SCHEDULE.MONTHLY);
    expect(normalizeDepositSchedule('flexible').schedule).toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
    expect(normalizeDepositSchedule('FLEXIBLE').schedule).toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
    expect(normalizeDepositSchedule(' flexible ').schedule).toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
  });

  it('absent values are monthly with NO problem reported (the normal legacy case)', () => {
    for (const v of [null, undefined, '']) {
      expect(normalizeDepositSchedule(v)).toEqual({ schedule: DEPOSIT_SCHEDULE.MONTHLY });
    }
  });

  it('a corrupt stored value is monthly PLUS a surfaced problem — never silently flexible', () => {
    const r = normalizeDepositSchedule('yearly-ish');
    expect(r.schedule).toBe(DEPOSIT_SCHEDULE.MONTHLY);
    expect(r.problem).toContain('yearly-ish');
    expect(r.problem).toContain('monthly');
  });
});

describe('resolveDepositScheduleDetailed — precedence', () => {
  it('a monthly tenant with a monthly member is fully enforced (every live tenant today)', () => {
    expect(resolveDepositScheduleDetailed({ tenantSchedule: 'monthly', memberDepositFrequency: 'monthly' }))
      .toMatchObject({ schedule: 'monthly', enforced: true });
  });

  it('defaults resolve to enforced monthly when nothing is configured', () => {
    expect(resolveDepositSchedule({})).toBe(DEPOSIT_SCHEDULE.MONTHLY);
    expect(isDepositObligationEnforced({})).toBe(true);
  });

  it('CRITICAL: a flexible tenant wins over the member rows that all still say "monthly"', () => {
    const r = resolveDepositScheduleDetailed({ tenantSchedule: 'flexible', memberDepositFrequency: 'monthly' });
    expect(r.schedule).toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
    expect(r.enforced).toBe(false);
  });

  it('a flexible tenant applies to members with an absent frequency too', () => {
    expect(resolveDepositSchedule({ tenantSchedule: 'flexible', memberDepositFrequency: null }))
      .toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
    expect(resolveDepositSchedule({ tenantSchedule: 'flexible' }))
      .toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
  });

  it('a non-monthly member is exempt inside a MONTHLY tenant (the pre-existing sweep behaviour)', () => {
    const r = resolveDepositScheduleDetailed({ tenantSchedule: 'monthly', memberDepositFrequency: 'quarterly' });
    expect(r.schedule).toBe(DEPOSIT_SCHEDULE.FLEXIBLE);
    expect(r.enforced).toBe(false);
  });

  it('a corrupt tenant value cannot exempt anyone', () => {
    const r = resolveDepositScheduleDetailed({ tenantSchedule: '🤷', memberDepositFrequency: 'monthly' });
    expect(r).toMatchObject({ schedule: DEPOSIT_SCHEDULE.MONTHLY, enforced: true });
    expect(r.problem).toBeTruthy();
  });

  it('echoes the inputs it resolved, for audit and error messages', () => {
    const r = resolveDepositScheduleDetailed({ tenantSchedule: 'flexible', memberDepositFrequency: 'monthly' });
    expect(r).toMatchObject({ tenantSchedule: 'flexible', memberDepositFrequency: 'monthly' });
  });

  it('normalises absent inputs to null rather than leaving them undefined', () => {
    const r = resolveDepositScheduleDetailed({});
    expect(r.tenantSchedule).toBeNull();
    expect(r.memberDepositFrequency).toBeNull();
  });
});

describe('the gate is total — every input pair resolves one way, never both', () => {
  const tenants = ['monthly', 'flexible', '', null, undefined, 'garbage'];
  const members = ['monthly', 'quarterly', '', null, undefined];

  it('returns exactly one schedule and a boolean enforced for all 90 combinations', () => {
    let monthlyCount = 0;
    for (const t of tenants) {
      for (const m of members) {
        const r = resolveDepositScheduleDetailed({ tenantSchedule: t, memberDepositFrequency: m });
        expect([DEPOSIT_SCHEDULE.MONTHLY, DEPOSIT_SCHEDULE.FLEXIBLE]).toContain(r.schedule);
        expect(typeof r.enforced).toBe('boolean');
        // The two fields may never contradict each other.
        expect(r.enforced).toBe(r.schedule === DEPOSIT_SCHEDULE.MONTHLY);
        if (r.schedule === DEPOSIT_SCHEDULE.MONTHLY) monthlyCount += 1;
      }
    }
    expect(monthlyCount).toBeGreaterThan(0);
  });

  it('fail-closed audit: a corrupt tenant value NEVER yields an unenforced monthly member', () => {
    for (const bad of ['garbage', 'FLEX', 'flexibly', '0', 'false']) {
      expect(isDepositObligationEnforced({ tenantSchedule: bad, memberDepositFrequency: 'monthly' })).toBe(true);
    }
  });
});
