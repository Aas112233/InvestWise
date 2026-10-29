/**
 * The obligation window must begin when the tenant's monthly rule began.
 *
 * Harm this locks (found while answering "should the deposit model be locked like share value?"):
 * `system_settings.deposit_schedule_changed_at` was stamped on every schedule switch and then read
 * by nothing — so a society that ran flexible and later chose monthly had its ENTIRE lookback window
 * judged as monthly. The nightly sweep would write PARTIAL/MISSED for months nobody was ever
 * required to pay into and could hold members for them on the very next run.
 *
 * These are behavioural, not source-text, assertions: `evaluateMemberFromLegs` is pure once the legs
 * are in hand, so the money claim can be proven without a database. Importing lib/governance/status-service.ts
 * is safe here — db/index.ts opens its pool lazily inside connectDB(), so nothing connects.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOVERNANCE_RULES,
  firstEnforcedPeriodKey,
  obligationStartPeriodKey,
} from "./status-rules";
import { evaluateMemberFromLegs, type GovernanceRulesSnapshot } from "./status-service";

const AS_OF = new Date(Date.UTC(2026, 9, 29)); // 29 October 2026
const REQUIRED_CENTS = 100_000; // 1,000.00 a month
const WINDOW_MONTHS = 6;

function snapshot(overrides: Partial<GovernanceRulesSnapshot> = {}): GovernanceRulesSnapshot {
  return {
    rules: DEFAULT_GOVERNANCE_RULES,
    shareValueCents: REQUIRED_CENTS,
    usedDefaults: false,
    depositSchedule: "monthly",
    depositScheduleChangedAt: null,
    ...overrides,
  };
}

/** A member who joined long ago and has never deposited — the worst case for a fake arrears. */
const dormantMember = {
  id: "member-1",
  memberId: "MEM-1",
  name: "Dormant Member",
  status: "ACTIVE",
  statusReason: null,
  shares: 1,
  monthlyDepositTarget: null,
  depositFrequency: "monthly",
  joinDate: new Date(Date.UTC(2024, 0, 15)),
  lastDepositMonth: null,
};

describe("obligationStartPeriodKey", () => {
  it("floors at the first WHOLE month under the new rule", () => {
    // A month already under way cannot be owed in full: on a 20 October switch with the deposit due
    // on the 10th, October's window closed before the tenant adopted monthly at all.
    expect(obligationStartPeriodKey({ depositSchedule: "monthly", changedAt: new Date(Date.UTC(2026, 9, 20)) })).toBe("2026-11");
    // The cost is at most one month of leniency when a switch lands on the 1st — the cheaper error
    // by a wide margin, since it can never penalise anyone.
    expect(obligationStartPeriodKey({ depositSchedule: "monthly", changedAt: new Date(Date.UTC(2026, 9, 1)) })).toBe("2026-11");
  });

  it("accepts the ISO string a driver may hand back, and rejects a junk stamp safely", () => {
    expect(obligationStartPeriodKey({ depositSchedule: "monthly", changedAt: "2026-09-30T11:00:00.000Z" })).toBe("2026-10");
    // An unusable stamp falls back to "no clamp", which keeps governance ON rather than silently
    // switching arrears detection off for a tenant that is plainly monthly.
    expect(obligationStartPeriodKey({ depositSchedule: "monthly", changedAt: "not-a-date" })).toBeNull();
    expect(obligationStartPeriodKey({ depositSchedule: "monthly", changedAt: null })).toBeNull();
  });

  it("returns no floor while the tenant is flexible", () => {
    expect(obligationStartPeriodKey({ depositSchedule: "flexible", changedAt: new Date() })).toBeNull();
    expect(obligationStartPeriodKey({ depositSchedule: "FLEXIBLE", changedAt: new Date() })).toBeNull();
  });

  it("treats an unreadable stored schedule as monthly, floor included", () => {
    // normalizeDepositSchedule fails CLOSED to monthly, and the floor follows that reading rather
    // than treating "unknown" as "no clamp": governance stays on, but a stamp still decides from
    // when. Both halves of the fail-closed rule have to agree or an unrecognised value would be
    // judged over the whole window while a recognised one was clamped.
    expect(obligationStartPeriodKey({ depositSchedule: null, changedAt: new Date(Date.UTC(2026, 8, 15)) })).toBe("2026-10");
    expect(obligationStartPeriodKey({ depositSchedule: "fortnightly", changedAt: new Date(Date.UTC(2026, 8, 15)) })).toBe("2026-10");
    expect(obligationStartPeriodKey({ depositSchedule: null, changedAt: null })).toBeNull();
  });
});

describe("firstEnforcedPeriodKey", () => {
  const base = { asOfPeriodKey: "2026-10", windowMonths: WINDOW_MONTHS };

  it("keeps the rule-derived window when the tenant has always been monthly", () => {
    expect(firstEnforcedPeriodKey(base)).toBe("2026-05");
    expect(firstEnforcedPeriodKey({ ...base, depositSchedule: "monthly", changedAt: null })).toBe("2026-05");
  });

  it("raises the start to the switch, and leaves it alone when the switch is older", () => {
    expect(firstEnforcedPeriodKey({ ...base, changedAt: new Date(Date.UTC(2026, 8, 30)) })).toBe("2026-10");
    // A pre-window switch must not SHRINK the window — that would drop months of real history.
    expect(firstEnforcedPeriodKey({ ...base, changedAt: new Date(Date.UTC(2024, 0, 31)) })).toBe("2026-05");
  });

  it("can legitimately start after the as-of month", () => {
    // Nothing is owed yet. Callers read this as an empty window, not as a perfect score.
    expect(firstEnforcedPeriodKey({ ...base, changedAt: new Date(Date.UTC(2026, 9, 20)) })).toBe("2026-11");
  });
});

describe("switching to monthly cannot create arrears for earlier months", () => {
  it("judges the whole window when the tenant has always been monthly", () => {
    const result = evaluateMemberFromLegs(dormantMember, [], snapshot(), AS_OF, WINDOW_MONTHS);
    expect(result.periods.map((p) => p.periodKey)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    // The pre-clamp behaviour for a switch: six months of arrears that never existed.
    expect(result.outstandingCents).toBe(6 * REQUIRED_CENTS);
    expect(result.hasQualifyingDeposit).toBe(false);
  });

  it("charges only from the first whole month after the switch", () => {
    const result = evaluateMemberFromLegs(
      dormantMember,
      [],
      snapshot({ depositScheduleChangedAt: new Date(Date.UTC(2026, 8, 30)) }), // 30 Sep
      AS_OF,
      WINDOW_MONTHS,
    );
    expect(result.periods.map((p) => p.periodKey)).toEqual(["2026-10"]);
    expect(result.outstandingCents).toBe(REQUIRED_CENTS);
    // May–September are absent, not "passed": no verdict is recorded for a month nobody owed.
    expect(result.periods.some((p) => p.periodKey < "2026-10")).toBe(false);
  });

  it("owes nothing at all in the month the tenant switched", () => {
    const result = evaluateMemberFromLegs(
      dormantMember,
      [],
      snapshot({ depositScheduleChangedAt: new Date(Date.UTC(2026, 9, 20)) }), // 20 Oct, same month
      AS_OF,
      WINDOW_MONTHS,
    );
    expect(result.periods).toEqual([]);
    expect(result.outstandingCents).toBe(0);
    // Not "compliant and exemplary" — simply not yet measurable. The scoring path reports this as
    // NOT_APPLICABLE rather than a 100 (see the depositMeasured note in performance.ts).
    expect(result.hasQualifyingDeposit).toBe(true);
  });

  it("shares ONE window definition with the deposit-legs query", () => {
    // The legs loader and the evaluation must agree, or a month whose money was never loaded would
    // be judged as missing. Asserted at source level because proving it end-to-end needs a database.
    const src = readFileSync("lib/governance/status-service.ts", "utf8");
    expect(src.match(/firstEnforcedPeriodKey\(\{/g)?.length).toBe(2);
    // The old hand-rolled window arithmetic is gone, not merely supplemented by a second source.
    expect(src).not.toContain("addMonthsToPeriodKey(toPeriodKey(asOf), -(windowMonths - 1))");
  });
});
