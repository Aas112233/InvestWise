/**
 * Governance deposit-compliance + member-status rules.
 *
 * PURE: no database, no network, no implicit clock. Every function takes the
 * "as of" instant explicitly so the daily sweep, the API and the tests all
 * evaluate the same month from the same inputs (§12 determinism).
 *
 * Vocabulary
 *   period key      'YYYY-MM', the month a deposit is *for* (not when it landed)
 *   deadline        last day of that month + depositDueDate + gracePeriodDays
 *   grace end       end of period key + lateDepositGraceMonths
 *
 * Grace protects *timeliness*, never *amount*: a deposit inside the grace
 * window is ON_TIME even if partial, and a full deposit outside it is LATE but
 * still settles that month's requirement. Only an unpaid month is MISSED.
 *
 * All money is integer cents (see ../money). All month math is UTC so the
 * result never shifts with the server's local timezone.
 */

import { sumCents, toCents } from "../money";
import { sharesToCents } from "../shares";
// Pure vocabulary module (it imports nothing), so this cannot create a cycle with governance.
import { DEPOSIT_SCHEDULE, normalizeDepositSchedule } from "../deposit-schedule/schedule";

export const MEMBER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;
export type MemberStatus = (typeof MEMBER_STATUS)[keyof typeof MEMBER_STATUS];

export function isMemberStatus(value: unknown): value is MemberStatus {
  return (
    value === MEMBER_STATUS.ACTIVE ||
    value === MEMBER_STATUS.INACTIVE ||
    value === MEMBER_STATUS.SUSPENDED
  );
}

/**
 * WHY a member is not active — the machine-readable companion to `status`.
 *
 * `status` is the coarse lifecycle state; this records the cause, so two
 * members who both read Inactive are no longer indistinguishable:
 *   - DEPOSIT_NON_COMPLIANCE  the governance sweep auto-held them (recoverable
 *                             by depositing; the sweep owns this state).
 *   - EQUITY_TRANSFERRED_OUT  they moved all equity + shares away and hold
 *                             nothing (NOT recoverable by depositing).
 *   - ADMIN_MANUAL            an admin set the state by hand (suspend, or a
 *                             manual hold); only an admin reverses it.
 *
 * Null means active, or a legacy row written before this column existed.
 * Keeping the cause OUT of the status value avoids a combinatorial explosion
 * of states (deposit_inactive, equity_inactive, ...) that still could not
 * represent a member who is inactive for two reasons at once.
 */
export const MEMBER_STATUS_REASON = {
  DEPOSIT_NON_COMPLIANCE: "DEPOSIT_NON_COMPLIANCE",
  EQUITY_TRANSFERRED_OUT: "EQUITY_TRANSFERRED_OUT",
  ADMIN_MANUAL: "ADMIN_MANUAL",
} as const;
export type MemberStatusReason = (typeof MEMBER_STATUS_REASON)[keyof typeof MEMBER_STATUS_REASON];

export function isMemberStatusReason(value: unknown): value is MemberStatusReason {
  return (
    value === MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE ||
    value === MEMBER_STATUS_REASON.EQUITY_TRANSFERRED_OUT ||
    value === MEMBER_STATUS_REASON.ADMIN_MANUAL
  );
}

export const DEPOSIT_COMPLIANCE = {
  ON_TIME: "ON_TIME",
  LATE: "LATE",
  PARTIAL: "PARTIAL",
  MISSED: "MISSED",
} as const;
export type DepositCompliance = (typeof DEPOSIT_COMPLIANCE)[keyof typeof DEPOSIT_COMPLIANCE];

export interface GovernanceRules {
  /** Last day of the month a deposit may be submitted for that same month. */
  depositDueDate: number;
  /** Day-level buffer added to `depositDueDate`. */
  gracePeriodDays: number;
  /** How many months after a period a late deposit is still accepted. */
  lateDepositGraceMonths: number;
  /** Months without a deposit before auto-hold. */
  inactiveAfterMonths: number;
  /** Months without a deposit before a member is SUSPENSION-ELIGIBLE. */
  suspendedAfterMonths: number;
}

export const DEFAULT_GOVERNANCE_RULES: GovernanceRules = {
  depositDueDate: 10,
  gracePeriodDays: 3,
  lateDepositGraceMonths: 1,
  inactiveAfterMonths: 3,
  suspendedAfterMonths: 6,
};

/** Hard bounds enforced on every settings write and read. */
export const GOVERNANCE_RULE_BOUNDS = {
  depositDueDate: { min: 1, max: 28 },
  gracePeriodDays: { min: 0, max: 30 },
  lateDepositGraceMonths: { min: 0, max: 6 },
  inactiveAfterMonths: { min: 1, max: 36 },
  suspendedAfterMonths: { min: 2, max: 60 },
} as const;

export class GovernanceRuleError extends Error {
  code: string;
  constructor(message: string, code = "INVALID_GOVERNANCE_RULE") {
    super(message);
    this.name = "GovernanceRuleError";
    this.code = code;
  }
}

function readBound(
  raw: unknown,
  bounds: { min: number; max: number },
  fallback: number,
  field: keyof GovernanceRules,
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new GovernanceRuleError(`${field} must be a whole number`, "NOT_AN_INTEGER");
  }
  if (n < bounds.min || n > bounds.max) {
    throw new GovernanceRuleError(
      `${field} must be between ${bounds.min} and ${bounds.max}`,
      "OUT_OF_RANGE",
    );
  }
  return n;
}

/**
 * Coerce a partial settings-shaped object into valid rules.
 * Throws on an out-of-range value or a broken ordering invariant — a silent
 * clamp here would quietly reconfigure a tenant's governance without a trace.
 */
export function normalizeGovernanceRules(input: Partial<GovernanceRules> | null | undefined): GovernanceRules {
  const src = input ?? {};
  const rules: GovernanceRules = {
    depositDueDate: readBound(src.depositDueDate, GOVERNANCE_RULE_BOUNDS.depositDueDate, DEFAULT_GOVERNANCE_RULES.depositDueDate, "depositDueDate"),
    gracePeriodDays: readBound(src.gracePeriodDays, GOVERNANCE_RULE_BOUNDS.gracePeriodDays, DEFAULT_GOVERNANCE_RULES.gracePeriodDays, "gracePeriodDays"),
    lateDepositGraceMonths: readBound(src.lateDepositGraceMonths, GOVERNANCE_RULE_BOUNDS.lateDepositGraceMonths, DEFAULT_GOVERNANCE_RULES.lateDepositGraceMonths, "lateDepositGraceMonths"),
    inactiveAfterMonths: readBound(src.inactiveAfterMonths, GOVERNANCE_RULE_BOUNDS.inactiveAfterMonths, DEFAULT_GOVERNANCE_RULES.inactiveAfterMonths, "inactiveAfterMonths"),
    suspendedAfterMonths: readBound(src.suspendedAfterMonths, GOVERNANCE_RULE_BOUNDS.suspendedAfterMonths, DEFAULT_GOVERNANCE_RULES.suspendedAfterMonths, "suspendedAfterMonths"),
  };

  if (rules.suspendedAfterMonths <= rules.inactiveAfterMonths) {
    throw new GovernanceRuleError(
      `suspendedAfterMonths (${rules.suspendedAfterMonths}) must be greater than inactiveAfterMonths (${rules.inactiveAfterMonths})`,
      "INVALID_THRESHOLD_ORDER",
    );
  }
  return rules;
}

// ── Period keys ────────────────────────────────────────────────────────────

const PERIOD_KEY_RE = /^(\d{4})-(\d{2})$/;

export function isValidPeriodKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const m = PERIOD_KEY_RE.exec(key);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** Validate and destructure a period key into numeric year/month. */
export function parsePeriodKey(periodKey: string): { year: number; month: number } {
  if (!isValidPeriodKey(periodKey)) {
    throw new GovernanceRuleError(`Invalid period key: "${periodKey}"`, "INVALID_PERIOD_KEY");
  }
  const [year, month] = periodKey.split("-").map(Number) as [number, number];
  return { year, month };
}

/** 'YYYY-MM' for the UTC month of `date`. */
export function toPeriodKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new GovernanceRuleError("Invalid date for period key", "INVALID_DATE");
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Shift a period key by whole months, clamping the day-of-month overflow. */
export function addMonthsToPeriodKey(periodKey: string, months: number): string {
  if (!isValidPeriodKey(periodKey)) {
    throw new GovernanceRuleError(`Invalid period key: "${periodKey}"`, "INVALID_PERIOD_KEY");
  }
  if (!Number.isInteger(months)) {
    throw new GovernanceRuleError("months must be a whole number", "NOT_AN_INTEGER");
  }
  const [yearPart, monthPart] = periodKey.split("-");
  const zeroBased = Number(yearPart) * 12 + (Number(monthPart) - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Whole months from `from` to `to`. Negative when `to` precedes `from`. */
export function monthsBetweenPeriodKeys(from: string, to: string): number {
  if (!isValidPeriodKey(from) || !isValidPeriodKey(to)) {
    throw new GovernanceRuleError(`Invalid period key: "${from}" / "${to}"`, "INVALID_PERIOD_KEY");
  }
  const [fy, fm] = from.split("-");
  const [ty, tm] = to.split("-");
  return Number(ty) * 12 + Number(tm) - (Number(fy) * 12 + Number(fm));
}

/** Whole months elapsed since `periodKey`, floored at 0. */
/**
 * The earliest month the tenant's MONTHLY obligation may be evaluated in, or null when the
 * obligation reaches back as far as the caller's own window.
 *
 * A tenant that ran flexible and later switched to monthly owed nothing during its flexible
 * months. Evaluating them anyway turns the lookback window into invented arrears — the nightly
 * sweep would write PARTIAL/MISSED for money nobody was ever required to pay and could hold the
 * member for it on the very next run. This is the same shape of rule as "months before the member
 * joined are not judged against them", applied to the tenant instead of the person.
 *
 * The floor is the month AFTER the switch, not the month of it. A month already under way when the
 * rule changed cannot be owed in full — on a 20 October switch with a 10th deposit due date, the
 * window for "October" closed a week before the tenant even adopted monthly, so charging it would
 * recreate the exact invented arrears this function exists to prevent. The cost is at most one
 * month of leniency when a switch lands on the 1st; the benefit is that no member is ever held for
 * a period that began before their obligation did.
 *
 * Returns null (no clamp) when:
 *  - the tenant is currently flexible — nothing monthly is evaluated at all;
 *  - it has never switched. `system_settings.deposit_schedule_changed_at` is stamped only when a
 *    switch is SAVED, so an always-monthly tenant keeps its full history;
 *  - the stored stamp is unusable, which falls back to the caller's own window rather than
 *    silently switching governance off.
 *
 * Note the direction this protects: flexible -> monthly. The reverse only ever turns measurement
 * off, and members held under the old rule are dealt with at the switch itself.
 */
export function obligationStartPeriodKey(input: {
  depositSchedule?: string | null;
  changedAt?: Date | string | null;
}): string | null {
  const schedule = normalizeDepositSchedule(input.depositSchedule ?? null).schedule;
  if (schedule !== DEPOSIT_SCHEDULE.MONTHLY) return null;
  const stamp = input.changedAt;
  if (!stamp) return null;
  const date = stamp instanceof Date ? stamp : new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  return addMonthsToPeriodKey(toPeriodKey(date), 1);
}

/**
 * Hard ceiling on any lookback window, in months. Lives here because the guard loop in
 * `buildPeriodRequirements` and the clamping in `firstEnforcedPeriodKey` both depend on it and they
 * must not disagree about what "far back" means.
 */
export const MAX_WINDOW_MONTHS = 60;

/**
 * The first month a monthly obligation may be charged in, combining the caller's lookback window
 * with the month the tenant actually became monthly.
 *
 * ONE definition on purpose: the deposit-legs query and the period evaluation must agree on the
 * window, or the evaluation would judge months the query never loaded and report them as missing.
 * That drift is a silent-arrears bug, not a crash, so it is exactly the kind of thing that must not
 * live in two places.
 *
 * The result may be LATER than the as-of month, and that is meaningful rather than a bug to clamp
 * away: a tenant that adopted monthly last month has no owed period yet. Callers must therefore
 * treat "start after the end" as an empty window — `buildPeriodRequirements` does — which reads as
 * "nothing owed", correctly, instead of either a fabricated arrears or a fake perfect score.
 */
export function firstEnforcedPeriodKey(input: {
  asOfPeriodKey: string;
  windowMonths: number;
  depositSchedule?: string | null;
  changedAt?: Date | string | null;
}): string {
  const windowMonths = Math.max(1, Math.min(MAX_WINDOW_MONTHS, Math.trunc(input.windowMonths) || 1));
  const windowStart = addMonthsToPeriodKey(input.asOfPeriodKey, -(windowMonths - 1));
  const floor = obligationStartPeriodKey({
    depositSchedule: input.depositSchedule,
    changedAt: input.changedAt,
  });
  if (floor === null) return windowStart;
  return floor > windowStart ? floor : windowStart;
}

export function monthsSincePeriodKey(periodKey: string, asOf: Date): number {
  return Math.max(0, monthsBetweenPeriodKeys(periodKey, toPeriodKey(asOf)));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamp `day` into the real length of the month (28 for Feb, 30 for Apr…). */
export function clampDayOfMonth(year: number, month: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(year, month));
}

/**
 * Submission deadline for `periodKey`: depositDueDate + gracePeriodDays,
 * clamped to the month's real last day.
 *
 * The legacy engine capped the sum at day 28, which silently discarded the
 * grace buffer whenever depositDueDate was late in the month (28 + 3 = 28).
 * Clamping to the month's length keeps the grace intact and never rolls over
 * into the following month.
 */
export function resolveDepositDeadline(periodKey: string, rules: Pick<GovernanceRules, "depositDueDate" | "gracePeriodDays">): Date {
  const { year, month } = parsePeriodKey(periodKey);
  const day = clampDayOfMonth(year, month, rules.depositDueDate + rules.gracePeriodDays);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

/**
 * Last instant a deposit still settles `periodKey`: end of the period plus
 * `lateDepositGraceMonths` whole months.
 */
export function resolveGraceEnd(periodKey: string, rules: Pick<GovernanceRules, "lateDepositGraceMonths">): Date {
  const finalKey = addMonthsToPeriodKey(periodKey, rules.lateDepositGraceMonths);
  const { year, month } = parsePeriodKey(finalKey);
  // Day 0 of the month after `month` is the last day of `month`.
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

// ── Per-month deposit compliance ───────────────────────────────────────────

export interface DepositLeg {
  date: Date;
  amountCents: number;
}

export interface MonthEvaluation {
  periodKey: string;
  requiredCents: number;
  depositedCents: number;
  shortfallCents: number;
  compliance: DepositCompliance;
  /** Date the cumulative total first reached `requiredCents`, else null. */
  qualifyingDate: Date | null;
  deadline: Date;
  graceEnd: Date;
  depositCount: number;
}

/**
 * Evaluate one period's deposits against the required amount.
 *
 * Deposit legs must be sorted ascending by date. Compliance ladder:
 *   nothing deposited            -> MISSED  (shortfall = required)
 *   reached the target <= grace  -> ON_TIME
 *   reached the target >  grace  -> LATE    (settled, just late)
 *   under the target             -> PARTIAL (shortfall = required - paid)
 */
export function evaluatePeriodDeposits(
  periodKey: string,
  legs: DepositLeg[],
  requiredCents: number,
  rules: Pick<GovernanceRules, "depositDueDate" | "gracePeriodDays" | "lateDepositGraceMonths">,
): MonthEvaluation {
  if (!Number.isInteger(requiredCents) || requiredCents < 0) {
    throw new GovernanceRuleError("requiredCents must be a non-negative integer", "INVALID_REQUIRED");
  }
  const ordered = [...legs].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const leg of ordered) {
    if (!Number.isInteger(leg.amountCents)) {
      throw new GovernanceRuleError("Deposit legs must carry integer cents", "INVALID_LEG");
    }
    if (Number.isNaN(leg.date.getTime())) {
      throw new GovernanceRuleError("Deposit leg has an invalid date", "INVALID_DATE");
    }
  }

  const deadline = resolveDepositDeadline(periodKey, rules);
  const graceEnd = resolveGraceEnd(periodKey, rules);
  const depositedCents = sumCents(ordered.map((l) => l.amountCents));

  let running = 0;
  let qualifyingDate: Date | null = null;
  for (const leg of ordered) {
    running += leg.amountCents;
    if (running >= requiredCents && requiredCents > 0) {
      qualifyingDate = leg.date;
      break;
    }
  }

  let compliance: DepositCompliance;
  if (depositedCents <= 0) {
    compliance = DEPOSIT_COMPLIANCE.MISSED;
  } else if (qualifyingDate && qualifyingDate.getTime() <= graceEnd.getTime()) {
    compliance = DEPOSIT_COMPLIANCE.ON_TIME;
  } else if (depositedCents < requiredCents) {
    compliance = DEPOSIT_COMPLIANCE.PARTIAL;
  } else {
    compliance = DEPOSIT_COMPLIANCE.LATE;
  }

  return {
    periodKey,
    requiredCents,
    depositedCents,
    shortfallCents: Math.max(0, requiredCents - depositedCents),
    compliance,
    qualifyingDate,
    deadline,
    graceEnd,
    depositCount: ordered.length,
  };
}

// ── Deposit → period attribution (the "bearable late deposit" rule) ────────

export interface PeriodRequirement {
  periodKey: string;
  requiredCents: number;
}

export interface PeriodAllocation {
  periodKey: string;
  requiredCents: number;
  allocatedCents: number;
  shortfallCents: number;
  legs: DepositLeg[];
}

export interface AllocationResult {
  allocations: PeriodAllocation[];
  /**
   * Deposits that could not be attributed to any in-scope period. Per §12 an
   * overpayment is never silently discarded — it must surface as an advance or
   * wallet credit, so callers must handle it.
   */
  unallocatedCents: number;
  unallocatedLegCount: number;
}

/**
 * Attribute deposits to the periods they SETTLE, not the month they landed in.
 *
 * A deposit dated in month M is eligible to settle any period in
 * [M - graceMonths, M]. Deposits are consumed oldest-first against the earliest
 * still-unsettled eligible period, splitting at cent precision — so a single
 * 1500.00 payment can settle a 500.00 August shortfall and carry 1000.00 into
 * September. This is what makes "late deposit" bearable rather than merely
 * late: a January subscription paid on 10 February settles January.
 *
 * Periods already settled are skipped rather than absorbing the surplus, so a
 * payment cascades forward to the next outstanding period. Money matching no
 * in-scope period is returned as unallocated instead of being swallowed.
 */
export function allocateDepositsToPeriods(
  legs: DepositLeg[],
  requirements: PeriodRequirement[],
  graceMonths: number,
): AllocationResult {
  if (!Number.isInteger(graceMonths) || graceMonths < 0) {
    throw new GovernanceRuleError("graceMonths must be a non-negative integer", "INVALID_GRACE_MONTHS");
  }
  if (requirements.length === 0) {
    // Nothing in scope: every cent is unattributable and must stay visible.
    const positive = legs.filter((l) => Number.isInteger(l.amountCents) && l.amountCents > 0);
    return {
      allocations: [],
      unallocatedCents: positive.reduce((sum, l) => sum + l.amountCents, 0),
      unallocatedLegCount: positive.length,
    };
  }

  const orderedRequirements = [...requirements].sort((a, b) =>
    a.periodKey < b.periodKey ? -1 : a.periodKey > b.periodKey ? 1 : 0,
  );
  for (const req of orderedRequirements) {
    if (!isValidPeriodKey(req.periodKey)) {
      throw new GovernanceRuleError(`Invalid period key: "${req.periodKey}"`, "INVALID_PERIOD_KEY");
    }
    if (!Number.isInteger(req.requiredCents) || req.requiredCents < 0) {
      throw new GovernanceRuleError(
        `requiredCents for ${req.periodKey} must be a non-negative integer`,
        "INVALID_REQUIRED",
      );
    }
  }

  const settled = new Map<string, number>();
  const allocated = new Map<string, DepositLeg[]>();
  for (const req of orderedRequirements) {
    settled.set(req.periodKey, 0);
    allocated.set(req.periodKey, []);
  }
  let unallocatedCents = 0;
  let unallocatedLegCount = 0;

  const orderedLegs = [...legs].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const leg of orderedLegs) {
    if (!Number.isInteger(leg.amountCents) || leg.amountCents < 0) {
      throw new GovernanceRuleError("Deposit legs must carry non-negative integer cents", "INVALID_LEG");
    }
    if (Number.isNaN(leg.date.getTime())) {
      throw new GovernanceRuleError("Deposit leg has an invalid date", "INVALID_DATE");
    }
    if (leg.amountCents === 0) continue;

    const legPeriod = toPeriodKey(leg.date);
    const earliestEligible = addMonthsToPeriodKey(legPeriod, -graceMonths);

    let remaining = leg.amountCents;
    for (const req of orderedRequirements) {
      if (remaining <= 0) break;
      if (req.periodKey > legPeriod) break;
      if (req.periodKey < earliestEligible) continue;

      const alreadySettled = settled.get(req.periodKey) ?? 0;
      const need = req.requiredCents - alreadySettled;
      // Already satisfied: skip so the surplus cascades to the next period.
      if (need <= 0) continue;

      const take = Math.min(need, remaining);
      allocated.get(req.periodKey)!.push({ date: leg.date, amountCents: take });
      settled.set(req.periodKey, alreadySettled + take);
      remaining -= take;
    }

    if (remaining > 0) {
      unallocatedCents += remaining;
      unallocatedLegCount += 1;
    }
  }

  const allocations: PeriodAllocation[] = orderedRequirements.map((req) => {
    const settledCents = settled.get(req.periodKey) ?? 0;
    return {
      periodKey: req.periodKey,
      requiredCents: req.requiredCents,
      allocatedCents: settledCents,
      shortfallCents: Math.max(0, req.requiredCents - settledCents),
      legs: allocated.get(req.periodKey) ?? [],
    };
  });

  return { allocations, unallocatedCents, unallocatedLegCount };
}

/** True when any period still owes money. Drives the auto-restore signal. */
export function hasOutstandingObligation(allocations: ReadonlyArray<{ shortfallCents: number }>): boolean {
  return allocations.some((a) => a.shortfallCents > 0);
}

/**
 * Monthly obligation for a member, in integer cents.
 *
 * An explicit `monthlyDepositTarget` always wins when it is a positive amount.
 * Otherwise the requirement is share value × shares, floored at ONE share so a
 * member recorded with 0 shares still carries an obligation rather than
 * silently passing every month.
 */
export function resolveRequiredMonthlyCents(
  member: { shares?: number | null; monthlyDepositTarget?: string | number | null },
  shareValueCents: number,
): number {
  const target = member.monthlyDepositTarget;
  if (target !== null && target !== undefined && target !== "") {
    const cents = toCents(target);
    if (cents > 0) return cents;
  }
  const shares = Number(member.shares ?? 0);
  const normalized = Number.isFinite(shares) ? Math.trunc(shares) : 1;
  return sharesToCents(Math.max(1, normalized), shareValueCents);
}

// ── Member status lifecycle ────────────────────────────────────────────────

export type StatusTransition =
  | "NONE"
  | "AUTO_HOLD"
  | "AUTO_RESTORE"
  | "SUSPENSION_ELIGIBLE"
  | "RESTORE_RECOMMENDED";

export interface StatusEvaluationInput {
  currentStatus: MemberStatus | string;
  /**
   * Why the member is currently inactive/suspended (null when active, or a
   * legacy row). The sweep uses it to decide whether it owns the state: a hold
   * IT created (DEPOSIT_NON_COMPLIANCE / null) is its to restore, but a state
   * caused by something else must be left for an explicit admin action.
   */
  statusReason?: MemberStatusReason | null;
  /** Whole months since the member's last qualifying deposit period. */
  monthsWithoutDeposit: number;
  /** A Completed deposit covering the required amount for the current period. */
  hasQualifyingDeposit: boolean;
  rules: GovernanceRules;
}

export interface StatusEvaluation {
  currentStatus: MemberStatus;
  nextStatus: MemberStatus;
  transition: StatusTransition;
  /** True when the sweep may persist `nextStatus` without an admin. */
  autoApply: boolean;
  /** True when an admin should be prompted to suspend. */
  suspensionEligible: boolean;
  /** True when an admin should be prompted to reinstate. */
  reinstateRecommended: boolean;
  monthsWithoutDeposit: number;
}

/**
 * Decide a member's status for the current cycle.
 *
 * Automatic: active -> inactive (hold), and inactive -> active once a
 * qualifying deposit lands.
 * Never automatic: active -> suspended, and suspended -> active. Suspension
 * blocks portal login, so it is always an explicit admin action; the sweep
 * only reports eligibility.
 *
 * The sweep only manages the holds IT created. A member inactive for a
 * non-deposit reason (equity transferred out, manual admin hold) is left
 * untouched — auto-restoring them on a deposit rule would silently erase the
 * real reason they are inactive.
 */
export function evaluateStatusTransition(input: StatusEvaluationInput): StatusEvaluation {
  const { rules } = input;
  const currentStatus = isMemberStatus(input.currentStatus) ? input.currentStatus : MEMBER_STATUS.ACTIVE;
  const months = Math.max(0, Math.trunc(input.monthsWithoutDeposit));
  // A missing reason is treated as deposit-driven (legacy rows written before
  // the column existed, and members the sweep itself held).
  const reasonOwnedBySweep =
    input.statusReason == null || input.statusReason === MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE;

  const base = {
    currentStatus,
    monthsWithoutDeposit: months,
  };

  if (currentStatus === MEMBER_STATUS.SUSPENDED) {
    return {
      ...base,
      nextStatus: MEMBER_STATUS.SUSPENDED,
      transition: input.hasQualifyingDeposit ? "RESTORE_RECOMMENDED" : "NONE",
      autoApply: false,
      suspensionEligible: true,
      reinstateRecommended: input.hasQualifyingDeposit,
    };
  }

  if (currentStatus === MEMBER_STATUS.INACTIVE) {
    // Not the sweep's state to manage: report it unchanged and take no action.
    if (!reasonOwnedBySweep) {
      return {
        ...base,
        nextStatus: MEMBER_STATUS.INACTIVE,
        transition: "NONE",
        autoApply: false,
        suspensionEligible: false,
        reinstateRecommended: false,
      };
    }
    if (input.hasQualifyingDeposit) {
      return {
        ...base,
        nextStatus: MEMBER_STATUS.ACTIVE,
        transition: "AUTO_RESTORE",
        autoApply: true,
        suspensionEligible: false,
        reinstateRecommended: false,
      };
    }
    if (months >= rules.suspendedAfterMonths) {
      return {
        ...base,
        nextStatus: MEMBER_STATUS.INACTIVE,
        transition: "SUSPENSION_ELIGIBLE",
        autoApply: false,
        suspensionEligible: true,
        reinstateRecommended: false,
      };
    }
    return {
      ...base,
      nextStatus: MEMBER_STATUS.INACTIVE,
      transition: "NONE",
      autoApply: false,
      suspensionEligible: false,
      reinstateRecommended: false,
    };
  }

  // ACTIVE
  if (months >= rules.inactiveAfterMonths) {
    return {
      ...base,
      nextStatus: MEMBER_STATUS.INACTIVE,
      transition: "AUTO_HOLD",
      autoApply: true,
      // unreachable while suspendedAfterMonths > inactiveAfterMonths, but
      // surfaced rather than swallowed if a hand-edited row breaks the order.
      suspensionEligible: months >= rules.suspendedAfterMonths,
      reinstateRecommended: false,
    };
  }

  return {
    ...base,
    nextStatus: MEMBER_STATUS.ACTIVE,
    transition: "NONE",
    autoApply: false,
    suspensionEligible: false,
    reinstateRecommended: false,
  };
}
