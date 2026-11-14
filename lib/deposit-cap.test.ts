import { describe, it, expect } from "vitest";
import { evaluateDepositCap } from "./deposit-cap";

// The runtime DB half of lib/deposit-cap.ts is a thin wrapper (lock the row,
// SUM the ledger, hand both to this pure decision — the same SUM predicate the
// deleted-transaction restore path already uses). The MONEY RULE lives here.
describe("evaluateDepositCap — the lifetime deposit ceiling", () => {
  const PM = "Project Level Member";

  it("exempts every category except Project Level Member", () => {
    for (const role of ["Shareholder Member", "Board Member", "Admin", null, undefined, 42]) {
      expect(evaluateDepositCap({ role, cap: "1000.00", cumulativeCents: 999_99, newCents: 1 })).toEqual({
        exempt: true,
        projectedCents: 0,
        capCents: null,
      });
    }
  });

  it("passes while cumulative + new stays at or under the cap", () => {
    expect(
      evaluateDepositCap({ role: PM, cap: "1000.00", cumulativeCents: 400_00, newCents: 500_00 }),
    ).toEqual({ exempt: false, projectedCents: 900_00, capCents: 1000_00 });
    // exactly at the cap is allowed — the cap is a ceiling, not a wall before it
    expect(
      evaluateDepositCap({ role: PM, cap: "1000.00", cumulativeCents: 400_00, newCents: 600_00 }),
    ).toEqual({ exempt: false, projectedCents: 1000_00, capCents: 1000_00 });
  });

  it("refuses one cent over the cap", () => {
    const d = evaluateDepositCap({ role: PM, cap: "1000.00", cumulativeCents: 400_00, newCents: 600_01 });
    expect(d.projectedCents).toBe(1000_01);
    expect(d.projectedCents).toBeGreaterThan(d.capCents!);
  });

  it("withdrawals never free headroom — cumulative is all that matters", () => {
    // Deposited 1000 of 1000 cap, withdrew 500: cumulative is STILL 1000, so a
    // new deposit is over. The caller feeds cumulative from the settled-deposit
    // ledger sum (withdrawals are other transaction types and never reduce it).
    const d = evaluateDepositCap({ role: PM, cap: "1000.00", cumulativeCents: 1000_00, newCents: 1 });
    expect(d.projectedCents).toBeGreaterThan(d.capCents!);
  });

  it("a Project Level Member row without a cap yields capCents=null → caller fails CLOSED", () => {
    for (const cap of [null, undefined, ""]) {
      const d = evaluateDepositCap({ role: PM, cap, cumulativeCents: 0, newCents: 1 });
      expect(d.exempt).toBe(false);
      expect(d.capCents).toBeNull();
    }
  });

  it("zero-amount validation (restore path shape) just re-checks the ledger total", () => {
    const d = evaluateDepositCap({ role: PM, cap: "1000.00", cumulativeCents: 1200_00, newCents: 0 });
    expect(d.projectedCents).toBe(1200_00); // already over → caller refuses the restore
  });

  it("parses the decimal-string cap through integer cents, never float", () => {
    const d = evaluateDepositCap({ role: PM, cap: "999999999.99", cumulativeCents: 0, newCents: 0 });
    expect(d.capCents).toBe(99999999999);
  });
});
