/**
 * Deposit schedule policy — the SINGLE source of truth for "is this member on the enforced
 * monthly obligation, or on flexible deposits?".
 *
 * PURE: no database, no network, no implicit clock — the same contract as
 * ../governance/status-rules.ts, so the sweep, the API and the tests all resolve the same
 * answer from the same inputs.
 *
 * Why this module exists
 * ----------------------
 * The monthly rule is not one rule. It is read by the duplicate guard
 * (`lib/deposit-month-limit.ts`), the governance sweep, performance scoring, the leaderboard
 * and the analysis payment matrix. If each of those re-derives "is this member monthly?" its
 * own way, one of them will forget — and the failure is silent in both directions: a flexible
 * member graded against a monthly obligation (they score F for obeying a rule that does not
 * apply to them), or a monthly member silently exempted from the duplicate check (double
 * -counted contribution and fund balance). So every consumer asks THIS module. Nothing
 * re-derives it.
 *
 * `monthly` reproduces the historical behaviour exactly. `flexible` removes the per-month
 * obligation and the one-deposit-per-month lock; it does NOT remove
 * `transactions.deposit_month`, which stays populated on every deposit so reports and the
 * analytics fiscal series keep working (docs/DEPOSIT_SCHEDULE_DESIGN.md §1).
 *
 * Fail closed: an unrecognised or corrupt value resolves to MONTHLY, the stricter state. A bad
 * settings row must never silently drop a tenant's members out of compliance.
 */

export const DEPOSIT_SCHEDULE = {
  MONTHLY: 'monthly',
  FLEXIBLE: 'flexible',
} as const;

export type DepositSchedule = (typeof DEPOSIT_SCHEDULE)[keyof typeof DEPOSIT_SCHEDULE];

/**
 * `members.deposit_frequency` values that mean "the enforced monthly schedule".
 *
 * Canonical list, moved here from `lib/governance/status-service.ts` so the sweep, the write
 * guard and the analysis matrix cannot drift apart. A missing value is monthly: that is the
 * column default and the pre-existing behaviour of every legacy row.
 */
const MONTHLY_FREQUENCY_VALUES = new Set<string>(['monthly', 'month', '1']);

export interface DepositScheduleSource {
  /** `system_settings.deposit_schedule` — the tenant default. */
  tenantSchedule?: string | null;
  /** `members.deposit_frequency` — the per-member value. */
  memberDepositFrequency?: string | null;
}

export interface DepositScheduleResolution extends DepositScheduleSource {
  schedule: DepositSchedule;
  /** True when the per-month obligation, duplicate lock and compliance rules apply. */
  enforced: boolean;
  /** Set when a stored value was unusable and MONTHLY was substituted. Never throws. */
  problem?: string;
}

function norm(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * True when `deposit_frequency` denotes the enforced monthly schedule.
 *
 * Exported from here and re-exported by `lib/governance/status-service.ts` so existing import
 * paths keep working while the vocabulary stays in one place.
 */
export function isMonthlyDepositFrequency(depositFrequency: string | null | undefined): boolean {
  // Byte-equivalent to the historical `isMonthlySchedule`: absent OR empty string is monthly
  // (the falsy check in the original covered both), anything else is an exact vocabulary
  // lookup after trim+lowercase. Preserved deliberately — a whitespace-only value read as
  // NON-monthly before and must still read as non-monthly now, or Phase 1 stops being a no-op.
  if (depositFrequency === null || depositFrequency === undefined || depositFrequency === '') return true;
  return MONTHLY_FREQUENCY_VALUES.has(String(depositFrequency).trim().toLowerCase());
}

/** Coerce a stored `deposit_schedule` value. Corrupt input fails closed to MONTHLY. */
export function normalizeDepositSchedule(raw: string | null | undefined): {
  schedule: DepositSchedule;
  problem?: string;
} {
  const v = norm(raw);
  if (v === '') return { schedule: DEPOSIT_SCHEDULE.MONTHLY };
  if (v === DEPOSIT_SCHEDULE.MONTHLY) return { schedule: DEPOSIT_SCHEDULE.MONTHLY };
  if (v === DEPOSIT_SCHEDULE.FLEXIBLE) return { schedule: DEPOSIT_SCHEDULE.FLEXIBLE };
  return {
    schedule: DEPOSIT_SCHEDULE.MONTHLY,
    problem: `deposit_schedule "${raw}" is not recognised; falling back to monthly`,
  };
}

/**
 * Resolve the schedule that governs one member.
 *
 * Precedence — flexible wins if EITHER source says flexible:
 *   1. the tenant turned the whole book over to flexible deposits, or
 *   2. this member's own `deposit_frequency` names a non-monthly cadence (the pre-existing
 *      per-member exemption the governance sweep already honours).
 *
 * Deliberate: an explicit tenant choice is NOT defeated by the member rows' stored
 * `'monthly'`, because `'monthly'` is that column's DEFAULT and every legacy member carries
 * it. Had a member-level value taken precedence, switching an existing tenant to flexible
 * would have changed nothing at all — the feature would look silently broken.
 *
 * `ponytail:` deliberate ceiling — there is no per-member opt-OUT inside a flexible tenant
 * (a member cannot force themselves back onto the enforced monthly rule). Upgrade path: a
 * nullable `members.deposit_schedule` column checked before the tenant default here, plus the
 * same fail-closed treatment. Not built because no tenant has asked for a mixed book.
 */
export function resolveDepositScheduleDetailed(src: DepositScheduleSource): DepositScheduleResolution {
  const { schedule, problem } = normalizeDepositSchedule(src.tenantSchedule);
  const memberSaysNonMonthly = !isMonthlyDepositFrequency(src.memberDepositFrequency);
  const isFlexible = schedule === DEPOSIT_SCHEDULE.FLEXIBLE || memberSaysNonMonthly;

  const resolution: DepositScheduleResolution = {
    tenantSchedule: src.tenantSchedule ?? null,
    memberDepositFrequency: src.memberDepositFrequency ?? null,
    schedule: isFlexible ? DEPOSIT_SCHEDULE.FLEXIBLE : DEPOSIT_SCHEDULE.MONTHLY,
    // Monthly is the enforced state; flexible removes the obligation and the month lock.
    enforced: !isFlexible,
  };
  if (problem) resolution.problem = problem;
  return resolution;
}

/** The schedule alone, for callers that do not care why. */
export function resolveDepositSchedule(src: DepositScheduleSource): DepositSchedule {
  return resolveDepositScheduleDetailed(src).schedule;
}

/**
 * THE gate. Every consumer asks this instead of re-deriving the rule.
 *
 * `false` means: no one-deposit-per-month lock, no obligation, no compliance evaluation, no
 * deposit-punctuality performance score. Money invariants (fiscal period, approval flow,
 * idempotency, soft delete, audit, tenant scope) are UNAFFECTED and stay enforced — see
 * docs/DEPOSIT_SCHEDULE_DESIGN.md §6.
 */
export function isDepositObligationEnforced(src: DepositScheduleSource): boolean {
  return resolveDepositScheduleDetailed(src).enforced;
}

/** Convenience for the write guard: is the duplicate-month lock in force for this member? */
export function isOneDepositPerMonthEnforced(src: DepositScheduleSource): boolean {
  return isDepositObligationEnforced(src);
}
