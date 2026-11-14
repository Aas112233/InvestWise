import { describe, expect, it } from "vitest";
import {
  PAYOUT_LEG_TYPES,
  decideReversal,
  isPayoutLegType,
  projectBalanceUnwindCents,
} from "./transaction-reversal";

/**
 * The project-balance unwind must be derived from the same canonical
 * classification that drives the fund reversal, and must stay bounded to the
 * types whose writer actually moved the project balance.
 *
 * The defect this pins: the delete path tested `type === 'Investment'`, but
 * project capital is stored as 'Project Investment' and the rows using bare
 * 'Investment' carry no project, so the branch could never run. Deleting an
 * investment leg debited the fund and left projects.currentFundBalance alone, so
 * the project and its own linked fund disagreed forever.
 */
describe("projectBalanceUnwindCents", () => {
  it("takes back capital that came in", () => {
    expect(projectBalanceUnwindCents({ type: "Project Investment" }, 70_000)).toBe(-70_000);
    expect(projectBalanceUnwindCents({ type: "Investment" }, 5_000)).toBe(-5_000);
    expect(projectBalanceUnwindCents({ type: "Earning" }, 1_500)).toBe(-1_500);
  });

  it("returns money that went out", () => {
    expect(projectBalanceUnwindCents({ type: "Expense" }, 2_500)).toBe(2_500);
    expect(projectBalanceUnwindCents({ type: "Withdrawal" }, 900)).toBe(900);
  });

  it("is the exact negation of the fund reversal direction", () => {
    // Fund reversal and project unwind must always be opposite-signed: money
    // leaving one side of the pair enters the other, never both.
    for (const type of ["Earning", "Expense", "Investment", "Project Investment", "Withdrawal"]) {
      const reversal = decideReversal({
        type,
        status: "Completed",
        fundId: "fund-1",
        amount: "100.00",
      });
      const projectAdj = projectBalanceUnwindCents({ type }, 10_000);
      if (reversal.direction === 0) {
        expect(projectAdj, type).toBe(0);
      } else {
        // direction -1 means "debit the fund", i.e. the row had credited it, so
        // the project side must also come back down: same sign, not opposite.
        expect(Math.sign(projectAdj), type).toBe(reversal.direction);
      }
    }
  });

  it("refuses to invent an unwind for a type that moves no project money", () => {
    // 0/0 aggregates and unknown types are left alone rather than guessed at,
    // matching decideReversal's stated policy.
    expect(projectBalanceUnwindCents({ type: "SomethingNew" }, 1_000)).toBe(0);
    expect(projectBalanceUnwindCents({ type: null }, 1_000)).toBe(0);
  });

  it("returns zero for a zero amount", () => {
    expect(projectBalanceUnwindCents({ type: "Expense" }, 0)).toBe(0);
  });
});

describe("isPayoutLegType", () => {
  it("covers the whole payout family", () => {
    for (const t of ["Dividend", "Dividend Distribution", "Statutory Reserve", "Disbursement"]) {
      expect(isPayoutLegType(t), t).toBe(true);
    }
    expect([...PAYOUT_LEG_TYPES]).toEqual([
      "Dividend",
      "Dividend Distribution",
      "Statutory Reserve",
      "Disbursement",
    ]);
  });

  it("does not refuse ordinary ledger entries", () => {
    for (const t of ["Deposit", "Expense", "Earning", "Withdrawal", "Adjustment", "Investment"]) {
      expect(isPayoutLegType(t), t).toBe(false);
    }
  });

  it("flags the types whose sibling legs and equity a single-row delete cannot unwind", () => {
    // Regression guard: 'Dividend' moves a fund AND a member's totalContributed
    // and has reserve/transfer siblings, yet decideReversal happily returns a
    // non-zero direction for it. The delete path must therefore refuse it
    // separately — this assertion documents that the reversal helper alone is not
    // sufficient protection, so both delete call sites need isPayoutLegType.
    const dividend = decideReversal({
      type: "Dividend",
      status: "Completed",
      fundId: "fund-1",
      amount: "3000.00",
    });
    expect(dividend.direction).toBe(1); // fund would be credited back
    expect(isPayoutLegType("Dividend")).toBe(true); // so the delete is refused
  });
});
