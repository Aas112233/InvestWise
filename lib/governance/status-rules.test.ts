import { describe, it, expect } from "vitest";
import {
  DEPOSIT_COMPLIANCE,
  DEFAULT_GOVERNANCE_RULES,
  GOVERNANCE_RULE_BOUNDS,
  MEMBER_STATUS,
  GovernanceRuleError,
  addMonthsToPeriodKey,
  allocateDepositsToPeriods,
  clampDayOfMonth,
  daysInMonth,
  evaluatePeriodDeposits,
  evaluateStatusTransition,
  hasOutstandingObligation,
  isValidPeriodKey,
  monthsBetweenPeriodKeys,
  monthsSincePeriodKey,
  normalizeGovernanceRules,
  resolveDepositDeadline,
  resolveGraceEnd,
  toPeriodKey,
} from "./status-rules";

const RULES = { depositDueDate: 10, gracePeriodDays: 3, lateDepositGraceMonths: 1 };
const REQUIRED = 100_000; // 1000.00 in cents
const d = (iso: string) => new Date(iso);

describe("normalizeGovernanceRules", () => {
  it("falls back to defaults for absent values", () => {
    expect(normalizeGovernanceRules({})).toEqual(DEFAULT_GOVERNANCE_RULES);
    expect(normalizeGovernanceRules(null)).toEqual(DEFAULT_GOVERNANCE_RULES);
  });

  it("accepts values inside the documented bounds", () => {
    const rules = normalizeGovernanceRules({
      depositDueDate: 15,
      gracePeriodDays: 5,
      lateDepositGraceMonths: 2,
      inactiveAfterMonths: 4,
      suspendedAfterMonths: 9,
    });
    expect(rules.depositDueDate).toBe(15);
    expect(rules.suspendedAfterMonths).toBe(9);
  });

  it("rejects out-of-range and non-integer values instead of silently clamping", () => {
    expect(() => normalizeGovernanceRules({ depositDueDate: 0 })).toThrow(GovernanceRuleError);
    expect(() => normalizeGovernanceRules({ depositDueDate: 29 })).toThrow(GovernanceRuleError);
    expect(() => normalizeGovernanceRules({ gracePeriodDays: 31 })).toThrow(GovernanceRuleError);
    expect(() => normalizeGovernanceRules({ inactiveAfterMonths: 37 })).toThrow(GovernanceRuleError);
    expect(() => normalizeGovernanceRules({ lateDepositGraceMonths: 7 })).toThrow(GovernanceRuleError);
    expect(() => normalizeGovernanceRules({ depositDueDate: 10.5 })).toThrow(/whole number/);
  });

  it("enforces suspendedAfterMonths > inactiveAfterMonths", () => {
    expect(() => normalizeGovernanceRules({ inactiveAfterMonths: 6, suspendedAfterMonths: 6 })).toThrow(
      /must be greater than/,
    );
    expect(() => normalizeGovernanceRules({ inactiveAfterMonths: 8, suspendedAfterMonths: 6 })).toThrow(
      /must be greater than/,
    );
  });

  it("keeps the bounds table in sync with the defaults", () => {
    for (const [field, bounds] of Object.entries(GOVERNANCE_RULE_BOUNDS)) {
      const value = DEFAULT_GOVERNANCE_RULES[field as keyof typeof DEFAULT_GOVERNANCE_RULES];
      expect(value).toBeGreaterThanOrEqual(bounds.min);
      expect(value).toBeLessThanOrEqual(bounds.max);
    }
  });
});

describe("period keys", () => {
  it("validates format and month range", () => {
    expect(isValidPeriodKey("2026-01")).toBe(true);
    expect(isValidPeriodKey("2026-12")).toBe(true);
    expect(isValidPeriodKey("2026-13")).toBe(false);
    expect(isValidPeriodKey("2026-00")).toBe(false);
    expect(isValidPeriodKey("2026-1")).toBe(false);
    expect(isValidPeriodKey("26-01")).toBe(false);
    expect(isValidPeriodKey(null)).toBe(false);
  });

  it("derives the UTC period key", () => {
    expect(toPeriodKey(d("2026-03-15T12:00:00Z"))).toBe("2026-03");
    expect(toPeriodKey(d("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(toPeriodKey(d("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("shifts period keys across year boundaries", () => {
    expect(addMonthsToPeriodKey("2026-01", 1)).toBe("2026-02");
    expect(addMonthsToPeriodKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToPeriodKey("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToPeriodKey("2026-06", 12)).toBe("2027-06");
  });

  it("counts whole months between keys in both directions", () => {
    expect(monthsBetweenPeriodKeys("2026-01", "2026-10")).toBe(9);
    expect(monthsBetweenPeriodKeys("2026-10", "2026-01")).toBe(-9);
    expect(monthsBetweenPeriodKeys("2025-11", "2026-02")).toBe(3);
    expect(monthsBetweenPeriodKeys("2026-03", "2026-03")).toBe(0);
  });

  it("floors months-since at zero and rejects bad keys", () => {
    expect(monthsSincePeriodKey("2026-10", d("2026-10-05T00:00:00Z"))).toBe(0);
    expect(monthsSincePeriodKey("2026-08", d("2026-10-05T00:00:00Z"))).toBe(2);
    expect(monthsSincePeriodKey("2026-11", d("2026-10-05T00:00:00Z"))).toBe(0);
    expect(() => monthsBetweenPeriodKeys("bad", "2026-01")).toThrow(GovernanceRuleError);
  });
});

describe("month length clamping", () => {
  it("knows real month lengths including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  it("clamps a day into the month", () => {
    expect(clampDayOfMonth(2026, 1, 31)).toBe(31);
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(clampDayOfMonth(2028, 2, 31)).toBe(29);
    expect(clampDayOfMonth(2026, 4, 31)).toBe(30);
    expect(clampDayOfMonth(2026, 6, 0)).toBe(1);
  });
});

describe("resolveDepositDeadline", () => {
  it("adds the grace buffer to the due date", () => {
    // 10 + 3 = 13
    expect(resolveDepositDeadline("2026-01", RULES).toISOString()).toBe("2026-01-13T23:59:59.999Z");
  });

  it("preserves grace for a late-month due date instead of capping at 28", () => {
    // The legacy engine did Math.min(28, 28 + 3) = 28, dropping the buffer.
    const rules = { depositDueDate: 28, gracePeriodDays: 3 };
    expect(resolveDepositDeadline("2026-01", rules).toISOString()).toBe("2026-01-31T23:59:59.999Z");
    // February clamps to its real last day rather than rolling into March.
    expect(resolveDepositDeadline("2026-02", rules).toISOString()).toBe("2026-02-28T23:59:59.999Z");
    // April clamps to the 30th.
    expect(resolveDepositDeadline("2026-04", rules).toISOString()).toBe("2026-04-30T23:59:59.999Z");
  });

  it("rejects an invalid period key", () => {
    expect(() => resolveDepositDeadline("2026-13", RULES)).toThrow(GovernanceRuleError);
  });
});

describe("resolveGraceEnd", () => {
  it("extends the window by the configured month count", () => {
    // January + 1 grace month -> last instant of February.
    expect(resolveGraceEnd("2026-01", RULES).toISOString()).toBe("2026-02-28T23:59:59.999Z");
    expect(resolveGraceEnd("2026-12", RULES).toISOString()).toBe("2027-01-31T23:59:59.999Z");
  });

  it("collapses to the period itself when grace is zero", () => {
    expect(resolveGraceEnd("2026-01", { lateDepositGraceMonths: 0 }).toISOString()).toBe(
      "2026-01-31T23:59:59.999Z",
    );
  });

  it("extends further with a wider month allowance", () => {
    expect(resolveGraceEnd("2026-01", { lateDepositGraceMonths: 3 }).toISOString()).toBe(
      "2026-04-30T23:59:59.999Z",
    );
  });
});

describe("evaluatePeriodDeposits", () => {
  it("marks an untouched month MISSED with the full shortfall", () => {
    const r = evaluatePeriodDeposits("2026-01", [], REQUIRED, RULES);
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.MISSED);
    expect(r.depositedCents).toBe(0);
    expect(r.shortfallCents).toBe(REQUIRED);
    expect(r.qualifyingDate).toBeNull();
    expect(r.depositCount).toBe(0);
  });

  it("marks a full deposit before the deadline ON_TIME", () => {
    const r = evaluatePeriodDeposits(
      "2026-01",
      [{ date: d("2026-01-05T00:00:00Z"), amountCents: REQUIRED }],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.ON_TIME);
    expect(r.shortfallCents).toBe(0);
    expect(r.qualifyingDate?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("keeps grace intact for a late-month due date", () => {
    const rules = { depositDueDate: 28, gracePeriodDays: 3, lateDepositGraceMonths: 1 };
    const r = evaluatePeriodDeposits(
      "2026-02",
      [{ date: d("2026-02-28T12:00:00Z"), amountCents: REQUIRED }],
      REQUIRED,
      rules,
    );
    // Feb 28 is the clamped deadline, so an intraday deposit still counts on time.
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.ON_TIME);
  });

  it("accepts a deposit inside the late grace window", () => {
    const r = evaluatePeriodDeposits(
      "2026-01",
      [{ date: d("2026-02-10T00:00:00Z"), amountCents: REQUIRED }],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.ON_TIME);
    expect(r.shortfallCents).toBe(0);
  });

  it("marks a full deposit past the grace window LATE but settled", () => {
    const r = evaluatePeriodDeposits(
      "2026-01",
      [{ date: d("2026-03-05T00:00:00Z"), amountCents: REQUIRED }],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.LATE);
    expect(r.shortfallCents).toBe(0);
    expect(r.depositedCents).toBe(REQUIRED);
  });

  it("marks an underpayment PARTIAL and never negative", () => {
    const r = evaluatePeriodDeposits(
      "2026-01",
      [{ date: d("2026-01-05T00:00:00Z"), amountCents: 40_000 }],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.PARTIAL);
    expect(r.shortfallCents).toBe(60_000);
  });

  it("finds the qualifying leg regardless of input order", () => {
    // Legs arrive newest-first. Sorted ascending, the Jan 8 leg alone clears
    // the target, so an unsorted walk would wrongly report Jan 9.
    const r = evaluatePeriodDeposits(
      "2026-01",
      [
        { date: d("2026-01-09T00:00:00Z"), amountCents: 70_000 },
        { date: d("2026-01-08T00:00:00Z"), amountCents: 100_000 },
      ],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.ON_TIME);
    expect(r.depositedCents).toBe(170_000);
    expect(r.qualifyingDate?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(r.depositCount).toBe(2);
  });

  it("qualifies a split payment only once the legs cumulatively clear the target", () => {
    // Neither leg alone meets 1000.00, so the requirement is only satisfied
    // once the second leg lands.
    const r = evaluatePeriodDeposits(
      "2026-01",
      [
        { date: d("2026-01-09T00:00:00Z"), amountCents: 30_000 },
        { date: d("2026-01-08T00:00:00Z"), amountCents: 70_000 },
      ],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.ON_TIME);
    expect(r.depositedCents).toBe(REQUIRED);
    expect(r.shortfallCents).toBe(0);
    expect(r.qualifyingDate?.toISOString()).toBe("2026-01-09T00:00:00.000Z");
    expect(r.depositCount).toBe(2);
  });

  it("keeps PARTIAL for an underpayment even inside the grace window", () => {
    // Grace protects timeliness, never amount.
    const r = evaluatePeriodDeposits(
      "2026-01",
      [{ date: d("2026-02-05T00:00:00Z"), amountCents: 50_000 }],
      REQUIRED,
      RULES,
    );
    expect(r.compliance).toBe(DEPOSIT_COMPLIANCE.PARTIAL);
    expect(r.shortfallCents).toBe(50_000);
  });

  it("rejects non-integer cents and negative required amounts", () => {
    expect(() =>
      evaluatePeriodDeposits("2026-01", [{ date: d("2026-01-05T00:00:00Z"), amountCents: 10.5 }], REQUIRED, RULES),
    ).toThrow(/integer cents/);
    expect(() => evaluatePeriodDeposits("2026-01", [], -1, RULES)).toThrow(/non-negative integer/);
  });
});

describe("evaluateStatusTransition", () => {
  const rules = normalizeGovernanceRules({ inactiveAfterMonths: 3, suspendedAfterMonths: 6 });

  it("leaves a current member alone", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.ACTIVE,
      monthsWithoutDeposit: 1,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.transition).toBe("NONE");
    expect(r.autoApply).toBe(false);
    expect(r.nextStatus).toBe(MEMBER_STATUS.ACTIVE);
  });

  it("holds an active member once the threshold is reached", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.ACTIVE,
      monthsWithoutDeposit: 3,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.transition).toBe("AUTO_HOLD");
    expect(r.nextStatus).toBe(MEMBER_STATUS.INACTIVE);
    expect(r.autoApply).toBe(true);
  });

  it("still holds at the suspension threshold rather than auto-suspending", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.ACTIVE,
      monthsWithoutDeposit: 8,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.transition).toBe("AUTO_HOLD");
    expect(r.nextStatus).toBe(MEMBER_STATUS.INACTIVE);
    expect(r.autoApply).toBe(true);
    // Surfaced rather than swallowed if a hand-edited row breaks threshold order.
    expect(r.suspensionEligible).toBe(true);
  });

  it("auto-restores a held member on a qualifying deposit", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.INACTIVE,
      monthsWithoutDeposit: 4,
      hasQualifyingDeposit: true,
      rules,
    });
    expect(r.transition).toBe("AUTO_RESTORE");
    expect(r.nextStatus).toBe(MEMBER_STATUS.ACTIVE);
    expect(r.autoApply).toBe(true);
  });

  it("flags a held member as suspension-eligible without changing status", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.INACTIVE,
      monthsWithoutDeposit: 6,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.transition).toBe("SUSPENSION_ELIGIBLE");
    expect(r.nextStatus).toBe(MEMBER_STATUS.INACTIVE);
    expect(r.autoApply).toBe(false);
    expect(r.suspensionEligible).toBe(true);
  });

  it("keeps a lightly held member unchanged", () => {
    const r = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.INACTIVE,
      monthsWithoutDeposit: 2,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.transition).toBe("NONE");
    expect(r.autoApply).toBe(false);
    expect(r.suspensionEligible).toBe(false);
  });

  it("never auto-reinstates a suspended member", () => {
    const withDeposit = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.SUSPENDED,
      monthsWithoutDeposit: 9,
      hasQualifyingDeposit: true,
      rules,
    });
    expect(withDeposit.transition).toBe("RESTORE_RECOMMENDED");
    expect(withDeposit.autoApply).toBe(false);
    expect(withDeposit.nextStatus).toBe(MEMBER_STATUS.SUSPENDED);
    expect(withDeposit.reinstateRecommended).toBe(true);

    const withoutDeposit = evaluateStatusTransition({
      currentStatus: MEMBER_STATUS.SUSPENDED,
      monthsWithoutDeposit: 9,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(withoutDeposit.transition).toBe("NONE");
    expect(withoutDeposit.reinstateRecommended).toBe(false);
  });

  it("coerces an unknown status to active rather than trusting it", () => {
    const r = evaluateStatusTransition({
      currentStatus: "banana",
      monthsWithoutDeposit: 5,
      hasQualifyingDeposit: false,
      rules,
    });
    expect(r.currentStatus).toBe(MEMBER_STATUS.ACTIVE);
    expect(r.transition).toBe("AUTO_HOLD");
  });
});

describe("allocateDepositsToPeriods", () => {
  const req = (periodKey: string, requiredCents: number) => ({ periodKey, requiredCents });

  it("settles a prior month from a deposit inside the grace window", () => {
    // January paid on 10 February still settles January: the whole point of
    // making a late deposit bearable.
    const r = allocateDepositsToPeriods(
      [{ date: d("2026-02-10T00:00:00Z"), amountCents: REQUIRED }],
      [req("2026-01", REQUIRED)],
      1,
    );
    const jan = r.allocations[0]!;
    expect(jan.allocatedCents).toBe(REQUIRED);
    expect(jan.shortfallCents).toBe(0);
    expect(r.unallocatedCents).toBe(0);
  });

  it("splits one payment across an older shortfall and the current period", () => {
    const r = allocateDepositsToPeriods(
      [{ date: d("2026-08-15T00:00:00Z"), amountCents: 150_000 }],
      [req("2026-07", 50_000), req("2026-08", 100_000)],
      1,
    );
    const jul = r.allocations.find((a) => a.periodKey === "2026-07")!;
    const aug = r.allocations.find((a) => a.periodKey === "2026-08")!;
    expect(jul.allocatedCents).toBe(50_000);
    expect(jul.shortfallCents).toBe(0);
    expect(aug.allocatedCents).toBe(100_000);
    expect(aug.shortfallCents).toBe(0);
    expect(r.unallocatedCents).toBe(0);
  });

  it("cascades a surplus past a period that is already settled", () => {
    const r = allocateDepositsToPeriods(
      [
        { date: d("2026-01-05T00:00:00Z"), amountCents: 100_000 },
        { date: d("2026-02-10T00:00:00Z"), amountCents: 100_000 },
      ],
      [req("2026-01", 100_000), req("2026-02", 100_000)],
      1,
    );
    expect(r.allocations.every((a) => a.shortfallCents === 0)).toBe(true);
    expect(r.unallocatedCents).toBe(0);
  });

  it("refuses to settle a period older than the grace window", () => {
    // March money cannot reach January when only one grace month is allowed.
    const r = allocateDepositsToPeriods(
      [{ date: d("2026-03-10T00:00:00Z"), amountCents: 100_000 }],
      [req("2026-01", 100_000)],
      1,
    );
    const jan = r.allocations.find((a) => a.periodKey === "2026-01")!;
    const feb = r.allocations.find((a) => a.periodKey === "2026-02")!;
    expect(jan.allocatedCents).toBe(0);
    expect(jan.shortfallCents).toBe(REQUIRED);
    expect(r.unallocatedCents).toBe(100_000);
    expect(r.unallocatedLegCount).toBe(1);
  });

  it("surfaces unallocated money rather than absorbing a surplus", () => {
    const r = allocateDepositsToPeriods(
      [{ date: d("2026-01-05T00:00:00Z"), amountCents: 250_000 }],
      [req("2026-01", 100_000)],
      0,
    );
    expect(r.allocations[0]!.allocatedCents).toBe(100_000);
    expect(r.unallocatedCents).toBe(150_000);
  });

  it("reports every cent as unallocated when no periods are in scope", () => {
    const r = allocateDepositsToPeriods(
      [
        { date: d("2026-01-05T00:00:00Z"), amountCents: 100_000 },
        { date: d("2026-01-06T00:00:00Z"), amountCents: 50_000 },
      ],
      [],
      1,
    );
    expect(r.allocations).toHaveLength(0);
    expect(r.unallocatedCents).toBe(150_000);
    expect(r.unallocatedLegCount).toBe(2);
  });

  it("consumes deposits oldest-first regardless of input order", () => {
    const r = allocateDepositsToPeriods(
      [
        { date: d("2026-02-10T00:00:00Z"), amountCents: 100_000 },
        { date: d("2026-01-05T00:00:00Z"), amountCents: 50_000 },
      ],
      [req("2026-01", 100_000), req("2026-02", 100_000)],
      1,
    );
    // Chronological order is Jan 50.00 then Feb 1000.00. February's money
    // finishes January's 500.00 shortfall first, then carries 500.00 forward.
    const jan = r.allocations.find((a) => a.periodKey === "2026-01")!;
    const feb = r.allocations.find((a) => a.periodKey === "2026-02")!;
    expect(jan.allocatedCents).toBe(100_000);
    expect(jan.shortfallCents).toBe(0);
    expect(feb.allocatedCents).toBe(50_000);
    expect(feb.shortfallCents).toBe(50_000);
    expect(r.unallocatedCents).toBe(0);
  });

  it("rejects invalid grace months and malformed requirements", () => {
    expect(() => allocateDepositsToPeriods([], [req("2026-01", 1)], -1)).toThrow(/non-negative integer/);
    expect(() => allocateDepositsToPeriods([], [req("2026-13", 1)], 1)).toThrow(GovernanceRuleError);
    expect(() => allocateDepositsToPeriods([], [req("2026-01", -5)], 1)).toThrow(/non-negative integer/);
  });

  it("reports an outstanding obligation only while a period still owes money", () => {
    const short = allocateDepositsToPeriods(
      [{ date: d("2026-01-05T00:00:00Z"), amountCents: 40_000 }],
      [req("2026-01", 100_000)],
      1,
    );
    expect(hasOutstandingObligation(short.allocations)).toBe(true);

    const clear = allocateDepositsToPeriods(
      [{ date: d("2026-01-05T00:00:00Z"), amountCents: 100_000 }],
      [req("2026-01", 100_000)],
      1,
    );
    expect(hasOutstandingObligation(clear.allocations)).toBe(false);
  });
});
