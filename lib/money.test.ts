import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  parsePositiveAmount,
  sumCents,
  splitDividendByShares,
  splitEvenlyCents,
  splitByPercent,
  splitByTypeAndShares,
  parsePercentBp,
  formatPercentBp,
  parseDepositMonthToIso,
  roundToCents,
  clampLossToEquity,
} from "./money";

describe("money boundary conversion", () => {
  it("converts decimal strings to cents exactly", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("0.01")).toBe(1);
    expect(toCents("1000000.00")).toBe(100_000_000);
    expect(toCents("-12.34")).toBe(-1234);
    expect(toCents("5")).toBe(500);
    expect(toCents("5.5")).toBe(550);
  });

  it("round-trips through fromCents", () => {
    for (const s of ["0.00", "0.99", "1234.56", "99999999.99", "-42.10"]) {
      expect(fromCents(toCents(s))).toBe(s);
    }
  });

  it("rejects invalid decimals and precision loss", () => {
    expect(() => toCents("12.345")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
    expect(() => toCents(NaN)).toThrow();
    expect(() => toCents(0.005)).toThrow(); // not representable at 2dp
    expect(() => toCents(12.345)).toThrow();
  });

  it("rounds half-away-from-zero", () => {
    expect(roundToCents(2.005)).toBe(201);
    expect(roundToCents(-2.005)).toBe(-201);
    expect(roundToCents(2.004)).toBe(200);
  });
});

describe("parsePositiveAmount (server-side amount>0 gate)", () => {
  it("accepts valid positive amounts", () => {
    expect(parsePositiveAmount("100.00")).toBe(10000);
    expect(parsePositiveAmount(0.01)).toBe(1);
  });

  it("rejects zero, negative and oversized", () => {
    expect(() => parsePositiveAmount("0.00")).toThrow();
    expect(() => parsePositiveAmount("-5")).toThrow();
    expect(() => parsePositiveAmount("20000000")).toThrow();
  });
});

describe("sumCents", () => {
  it("sums exactly without float drift", () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([toCents("0.01"), toCents("0.02")])).toBe(3);
    expect(sumCents([])).toBe(0);
  });
});

describe("splitDividendByShares — double-entry safe distribution", () => {
  it("distributes exactly the total with no phantom cents", () => {
    const members = [
      { id: "a", shares: 3 },
      { id: "b", shares: 2 },
      { id: "c", shares: 5 },
    ];
    const total = toCents("1000.00");
    const payouts = splitDividendByShares(total, members);
    const sum = payouts.reduce((acc, p) => acc + p.payoutCents, 0);
    expect(sum).toBe(total);
    expect(payouts.find((p) => p.id === "a")?.payoutCents).toBe(30000);
    expect(payouts.find((p) => p.id === "b")?.payoutCents).toBe(20000);
    expect(payouts.find((p) => p.id === "c")?.payoutCents).toBe(50000);
  });

  it("handles indivisible remainders deterministically (largest remainder)", () => {
    const members = [
      { id: "a", shares: 1 },
      { id: "b", shares: 1 },
      { id: "c", shares: 1 },
    ];
    const total = 100; // 100 cents / 3 shares = 33.33... cents each
    const payouts = splitDividendByShares(total, members);
    const sum = payouts.reduce((acc, p) => acc + p.payoutCents, 0);
    expect(sum).toBe(total);
    // All equal shares -> all get 33 or 34; the extra cent goes to exactly one
    const cents = payouts.map((p) => p.payoutCents).sort((x, y) => y - x);
    expect(cents).toEqual([34, 33, 33]);
    // Deterministic: same input, same output
    const again = splitDividendByShares(total, members);
    expect(again).toEqual(payouts);
  });

  it("skips zero-share members but still balances", () => {
    const members = [
      { id: "a", shares: 10 },
      { id: "b", shares: 0 },
    ];
    const payouts = splitDividendByShares(500, members);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]!.payoutCents).toBe(500);
  });

  it("throws when no shares exist (NO_SHARES)", () => {
    expect(() => splitDividendByShares(1000, [{ id: "a", shares: 0 }])).toThrow(/shares/i);
  });

  it("never exceeds the requested total across 200 randomized runs", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      const members = Array.from({ length: 1 + Math.floor(rand() * 12) }, (_, i) => ({
        id: `m${i}`,
        shares: Math.floor(rand() * 50) + 1,
      }));
      const total = Math.floor(rand() * 1_000_000) + 1;
      const payouts = splitDividendByShares(total, members);
      const sum = payouts.reduce((acc, p) => acc + p.payoutCents, 0);
      expect(sum).toBeLessThanOrEqual(total);
      expect(sum).toBeGreaterThanOrEqual(total - members.length);
      for (const p of payouts) expect(p.payoutCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parsePercentBp", () => {
  it("converts percents to integer basis points", () => {
    expect(parsePercentBp("20.5")).toBe(2050);
    expect(parsePercentBp(20.5)).toBe(2050);
    expect(parsePercentBp("100")).toBe(10_000);
    expect(parsePercentBp("0.01")).toBe(1);
  });

  it("rejects zero, negative, >100 and 3dp values", () => {
    expect(() => parsePercentBp("0")).toThrow(/greater than zero/);
    expect(() => parsePercentBp("-1")).toThrow(/greater than zero/);
    expect(() => parsePercentBp("100.01")).toThrow(/at most 100/);
    expect(() => parsePercentBp("12.345")).toThrow();
  });
});

describe("splitByPercent — exact-cents percentage split", () => {
  it("splits 100% of the total across funds exactly", () => {
    const total = toCents("1000.00");
    const payouts = splitByPercent(total, [
      { id: "a", bp: 3000 },
      { id: "b", bp: 2000 },
      { id: "c", bp: 5000 },
    ]);
    expect(payouts.find((p) => p.id === "a")?.payoutCents).toBe(30_000);
    expect(payouts.find((p) => p.id === "b")?.payoutCents).toBe(20_000);
    expect(payouts.find((p) => p.id === "c")?.payoutCents).toBe(50_000);
    expect(payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(total);
  });

  it("partial weight sum claims only that block, leaving the exact remainder", () => {
    const total = toCents("1000.00");
    const payouts = splitByPercent(total, [
      { id: "a", bp: 2000 },
      { id: "b", bp: 4000 },
    ]);
    const block = payouts.reduce((s, p) => s + p.payoutCents, 0);
    expect(block).toBe(60_000); // 60% of 1000.00
    expect(total - block).toBe(40_000); // members' remainder is exact
    expect(payouts.find((p) => p.id === "a")?.payoutCents).toBe(20_000);
    expect(payouts.find((p) => p.id === "b")?.payoutCents).toBe(40_000);
  });

  it("rounds the block half-up when the percent of the total is not integral", () => {
    // 25% of 1.01 = 25.25 cents -> 25 (half-up); members get the exact 76.
    const payouts = splitByPercent(101, [{ id: "a", bp: 2500 }]);
    expect(payouts[0]?.payoutCents).toBe(25);
    expect(101 - payouts[0]!.payoutCents).toBe(76);
  });

  it("deals indivisible cents by largest remainder, deterministic and id-sorted", () => {
    const entries = [
      { id: "c", bp: 3334 },
      { id: "a", bp: 3333 },
      { id: "b", bp: 3333 },
    ];
    const payouts = splitByPercent(100, entries);
    expect(payouts.map((p) => p.id)).toEqual(["a", "b", "c"]); // id-sorted
    expect(payouts.find((p) => p.id === "a")?.payoutCents).toBe(33);
    expect(payouts.find((p) => p.id === "b")?.payoutCents).toBe(33);
    expect(payouts.find((p) => p.id === "c")?.payoutCents).toBe(34);
    expect(payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(100);
    expect(splitByPercent(100, entries)).toEqual(payouts); // stable
  });

  it("rejects weight sums above 100%", () => {
    expect(() => splitByPercent(10_000, [{ id: "a", bp: 6000 }, { id: "b", bp: 6000 }]))
      .toThrow(/exceed 100%/);
  });

  it("rejects invalid totals and empty weight sets", () => {
    expect(() => splitByPercent(0, [{ id: "a", bp: 100 }])).toThrow();
    expect(() => splitByPercent(100, [])).toThrow();
  });

  it("never drifts from the rounded block across 200 randomized runs", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      const n = 1 + Math.floor(rand() * 8);
      let budget = 10_000;
      const entries = Array.from({ length: n }, (_, i) => {
        const slotsAfter = n - 1 - i; // non-last entries still to place
        const maxBp = Math.max(1, Math.min(budget - slotsAfter, 5_000));
        const bp = i === n - 1 ? budget : 1 + Math.floor(rand() * maxBp);
        budget -= bp;
        return { id: `f${i}`, bp };
      });
      const total = Math.floor(rand() * 1_000_000) + 1;
      const sumBp = entries.reduce((s, e) => s + e.bp, 0);
      const payouts = splitByPercent(total, entries);
      const block = Math.floor((total * sumBp) / 10_000 + 0.5);
      expect(payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(block);
      for (const p of payouts) expect(p.payoutCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("splitByTypeAndShares — category-weighted pool split", () => {
  const payoutOf = (
    outcome: ReturnType<typeof splitByTypeAndShares>,
    id: string,
  ): number => outcome.payouts.find((p) => p.id === id)?.payoutCents ?? -1;

  it("empty rules are byte-identical to splitDividendByShares", () => {
    const members = [
      { id: "a", shares: 3, role: "Member" },
      { id: "b", shares: 2, role: "Board Member" },
      { id: "c", shares: 5, role: "Member" },
    ];
    const total = toCents("1000.00");
    const plain = splitDividendByShares(total, members);
    const typed = splitByTypeAndShares(total, members, new Map());
    expect(typed.payouts).toEqual(plain);
    expect(typed.typeBlocks).toEqual([]);
    expect(typed.remainderCents).toBe(total);
  });

  it("carves the category block, then pro-rata inside and remainder outside", () => {
    // Board Member 15% of 1000.00 = 150.00 -> A(2 sh) 100.00 + B(1 sh) 50.00;
    // remainder 850.00 goes pro-rata to the unconfigured member C.
    const outcome = splitByTypeAndShares(
      toCents("1000.00"),
      [
        { id: "a", shares: 2, role: "Board Member" },
        { id: "b", shares: 1, role: "Board Member" },
        { id: "c", shares: 5, role: "Member" },
      ],
      new Map([["Board Member", 1500]]),
    );
    expect(payoutOf(outcome, "a")).toBe(10_000);
    expect(payoutOf(outcome, "b")).toBe(5_000);
    expect(payoutOf(outcome, "c")).toBe(85_000);
    expect(outcome.remainderCents).toBe(85_000);
    expect(outcome.typeBlocks).toEqual([
      { role: "Board Member", bp: 1500, amountCents: 15_000, memberCount: 2 },
    ]);
    expect(outcome.payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(toCents("1000.00"));
  });

  it("100% configured category starves the unconfigured members exactly", () => {
    const outcome = splitByTypeAndShares(
      50_000,
      [
        { id: "a", shares: 1, role: "Board Member" },
        { id: "c", shares: 5, role: "Member" },
      ],
      new Map([["Board Member", 10_000]]),
    );
    expect(payoutOf(outcome, "a")).toBe(50_000);
    expect(payoutOf(outcome, "c")).toBe(0);
    expect(outcome.remainderCents).toBe(0);
  });

  it("configured category with no members present claims nothing", () => {
    // The club-dividend case: rules mention Project Member, none are on the roster.
    const members = [
      { id: "a", shares: 3, role: "Member" },
      { id: "b", shares: 1, role: "Board Member" },
    ];
    const outcome = splitByTypeAndShares(
      10_000,
      members,
      new Map([
        ["Project Member", 4000],
        ["Board Member", 1000],
      ]),
    );
    // Board block 10% = 1000 to b; remainder 9000 pro-rata to the unconfigured
    // member a. Project Member claims 0.
    expect(payoutOf(outcome, "b")).toBe(1_000);
    expect(payoutOf(outcome, "a")).toBe(9_000);
    expect(outcome.typeBlocks.map((t) => t.role)).toEqual(["Board Member"]);
  });

  it("remainder falls to ALL members when every eligible member is configured", () => {
    // Board 30% + Investor 30% of 1000.00, all members are Board or Investor:
    // blocks 300 + 300, remainder 400 pro-rata across everyone by shares.
    const outcome = splitByTypeAndShares(
      toCents("1000.00"),
      [
        { id: "a", shares: 1, role: "Board Member" },
        { id: "b", shares: 1, role: "Investor" },
      ],
      new Map([
        ["Board Member", 3000],
        ["Investor", 3000],
      ]),
    );
    // Blocks: a=300.00, b=300.00; remainder 400.00 split 200/200.
    expect(payoutOf(outcome, "a")).toBe(50_000);
    expect(payoutOf(outcome, "b")).toBe(50_000);
    expect(outcome.remainderCents).toBe(40_000);
  });

  it("rules for a role absent from the pool behave like plain pro-rata", () => {
    const members = [
      { id: "a", shares: 3, role: "Member" },
      { id: "b", shares: 1, role: "Member" },
    ];
    const outcome = splitByTypeAndShares(1000, members, new Map([["Auditor", 2500]]));
    expect(outcome.payouts).toEqual(splitDividendByShares(1000, members));
    expect(outcome.typeBlocks).toEqual([]);
  });

  it("excludes zero-share members and keeps the identity of payouts", () => {
    const outcome = splitByTypeAndShares(
      1_000,
      [
        { id: "a", shares: 1, role: "Board Member" },
        { id: "z", shares: 0, role: "Board Member" },
      ],
      new Map([["Board Member", 10_000]]),
    );
    expect(outcome.payouts).toEqual([{ id: "a", shares: 1, payoutCents: 1_000 }]);
  });

  it("handles cent-level edges without losing cents", () => {
    // 1 cent across two 50% categories: one block gets the cent, the other 0.
    const outcome = splitByTypeAndShares(
      1,
      [
        { id: "a", shares: 1, role: "Board Member" },
        { id: "b", shares: 1, role: "Investor" },
      ],
      new Map([
        ["Board Member", 5000],
        ["Investor", 5000],
      ]),
    );
    expect(outcome.payouts.reduce((s, p) => s + p.payoutCents, 0)).toBe(1);
  });

  it("rejects invalid totals, empty rosters and bad weights", () => {
    const members = [{ id: "a", shares: 1, role: "Member" }];
    expect(() => splitByTypeAndShares(0, members, new Map())).toThrow();
    expect(() => splitByTypeAndShares(1.5, members, new Map())).toThrow();
    expect(() => splitByTypeAndShares(100, [{ id: "a", shares: 0, role: "Member" }], new Map())).toThrow(/shares/i);
    expect(() => splitByTypeAndShares(100, members, new Map([["Member", 0]]))).toThrow();
    expect(() => splitByTypeAndShares(100, members, new Map([["Member", 10001]]))).toThrow();
    expect(() => splitByTypeAndShares(100, members, new Map([["Member", 50.5]]))).toThrow();
  });

  it("conserves every cent across 300 randomized category mixes", () => {
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const roles = ["Board Member", "Member", "Investor", "Project Member"];
    for (let run = 0; run < 300; run++) {
      const members = Array.from({ length: 1 + Math.floor(rand() * 10) }, (_, i) => ({
        id: `m${String(i).padStart(2, "0")}`,
        shares: Math.floor(rand() * 40), // includes 0-share members
        role: roles[Math.floor(rand() * roles.length)]!,
      }));
      const eligibleCount = members.filter((m) => m.shares > 0).length;
      if (eligibleCount === 0) continue;
      // Random rules: up to 3 roles, Σ ≤ 100%.
      const rules = new Map<string, number>();
      let budget = 10_000;
      const ruleCount = Math.floor(rand() * 4); // 0..3 (0 => plain pro-rata)
      for (let r = 0; r < ruleCount && budget > 0; r++) {
        const role = roles[Math.floor(rand() * roles.length)]!;
        if (rules.has(role)) continue;
        const bp = 1 + Math.floor(rand() * Math.min(budget, 6000));
        rules.set(role, bp);
        budget -= bp;
      }
      const total = Math.floor(rand() * 2_000_000) + 1;
      const outcome = splitByTypeAndShares(total, members, rules);
      const sum = outcome.payouts.reduce((s, p) => s + p.payoutCents, 0);
      expect(sum).toBe(total); // conservation, always
      expect(outcome.payouts.length).toBe(eligibleCount);
      expect(outcome.remainderCents).toBe(total - outcome.typeBlocks.reduce((s, t) => s + t.amountCents, 0));
      for (const p of outcome.payouts) expect(p.payoutCents).toBeGreaterThanOrEqual(0);
      // Determinism: same input, same output.
      expect(splitByTypeAndShares(total, members, rules).payouts).toEqual(outcome.payouts);
    }
  });
});

describe("parseDepositMonthToIso", () => {
  it("parses english month labels", () => {
    expect(parseDepositMonthToIso("January 2024")).toBe("2024-01-01");
    expect(parseDepositMonthToIso("Sep 2025")).toBe("2025-09-01");
  });

  it("parses bengali labels and digits", () => {
    expect(parseDepositMonthToIso("জানুয়ারি ২০২৪")).toBe("2024-01-01");
    expect(parseDepositMonthToIso("ডিসেম্বর 2025")).toBe("2025-12-01");
  });

  it("parses iso yyyy-mm keys", () => {
    expect(parseDepositMonthToIso("2024-03")).toBe("2024-03-01");
  });

  it("returns null for garbage", () => {
    expect(parseDepositMonthToIso("not a month")).toBeNull();
    expect(parseDepositMonthToIso("")).toBeNull();
    expect(parseDepositMonthToIso(null)).toBeNull();
    expect(parseDepositMonthToIso("2024-13")).toBeNull();
  });
});

describe("clampLossToEquity — a loss debit can never exceed recorded equity", () => {
  // Plain pro-rata re-allocation: enough to exercise the clamp without pulling
  // in the category engine (which has its own suite below).
  const proRata = (shortfall: number, candidates: Array<{ id: string; shares: number }>) =>
    splitDividendByShares(
      shortfall,
      candidates.map((c) => ({ id: c.id, shares: c.shares, payoutCents: 0 })),
    );

  const shares = (...entries: Array<[string, number]>) => new Map(entries);

  it("leaves an in-cap loss untouched and clamps nothing", () => {
    const out = clampLossToEquity(
      new Map([["a", 100_00], ["b", 300_00]]),
      new Map([["a", 500_00], ["b", 500_00]]),
      proRata,
      shares(["a", 1], ["b", 3]),
    );
    expect(out.appliedCents.get("a")).toBe(100_00);
    expect(out.appliedCents.get("b")).toBe(300_00);
    expect(out.unabsorbedCents).toBe(0);
  });

  it("caps a member at their equity and moves the excess to one who can absorb it", () => {
    // a is asked for 400 but only has 100: the 300 excess lands on b.
    const out = clampLossToEquity(
      new Map([["a", 400_00], ["b", 0]]),
      new Map([["a", 100_00], ["b", 900_00]]),
      proRata,
      shares(["a", 1], ["b", 1]),
    );
    expect(out.appliedCents.get("a")).toBe(100_00);
    expect(out.appliedCents.get("b")).toBe(300_00);
    expect(out.unabsorbedCents).toBe(0);
  });

  it("records only the debits equity can back when equity runs out entirely", () => {
    // 100 available in total against 400 requested: 300 is unabsorbed, and that
    // is reported rather than silently dropped.
    const out = clampLossToEquity(
      new Map([["a", 200_00], ["b", 200_00]]),
      new Map([["a", 60_00], ["b", 40_00]]),
      proRata,
      shares(["a", 1], ["b", 1]),
    );
    expect(out.appliedCents.get("a")).toBe(60_00);
    expect(out.appliedCents.get("b")).toBe(40_00);
    expect(out.unabsorbedCents).toBe(300_00);
    const total = [...out.appliedCents.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(100_00);
  });

  it("never debits a zero-equity member even when they hold shares", () => {
    const out = clampLossToEquity(
      new Map([["broke", 500_00], ["rich", 0]]),
      new Map([["broke", 0], ["rich", 800_00]]),
      proRata,
      shares(["broke", 5], ["rich", 5]),
    );
    expect(out.appliedCents.get("broke")).toBe(0);
    expect(out.appliedCents.get("rich")).toBe(500_00);
    expect(out.unabsorbedCents).toBe(0);
  });

  it("a Both run clamps against post-profit equity, not the pre-profit balance", () => {
    // Profit leg credited 700 to a; the loss leg may then debit that 700.
    const equityAfterProfit = new Map([["a", 700_00], ["b", 100_00]]);
    const loss = clampLossToEquity(
      new Map([["a", 500_00], ["b", 50_00]]),
      equityAfterProfit,
      proRata,
      shares(["a", 1], ["b", 1]),
    );
    expect(loss.appliedCents.get("a")).toBe(500_00);
    expect(loss.unabsorbedCents).toBe(0);
  });

  it("conserves cents: applied never exceeds requested and never negative", () => {
    const requested = new Map([["a", 33_33], ["b", 33_33], ["c", 33_34]]);
    const out = clampLossToEquity(
      requested,
      new Map([["a", 10_00], ["b", 1_00], ["c", 10_00]]),
      proRata,
      shares(["a", 1], ["b", 1], ["c", 1]),
    );
    let applied = 0;
    for (const [id, cents] of out.appliedCents) {
      expect(cents).toBeGreaterThanOrEqual(0);
      expect(cents).toBeLessThanOrEqual(requested.get(id)!);
      applied += cents;
    }
    expect(applied).toBe(21_00); // every member capped at their equity
    expect(out.unabsorbedCents).toBe(79_00);
    expect(applied + out.unabsorbedCents).toBe(100_00);
  });
});

describe("formatPercentBp — the exact inverse of parsePercentBp", () => {
  it("renders integer basis points as fixed-2dp percent text", () => {
    expect(formatPercentBp(1250)).toBe("12.50");
    expect(formatPercentBp(20)).toBe("0.20");
    expect(formatPercentBp(10_000)).toBe("100.00");
    expect(formatPercentBp(0)).toBe("0.00");
  });

  it("round-trips legal percents to canonical 2dp text (no float tails)", () => {
    const cases: Array<[string, string]> = [
      ["0.01", "0.01"],
      ["1", "1.00"],
      ["12.5", "12.50"],
      ["12.50", "12.50"],
      ["33.33", "33.33"],
      ["99.99", "99.99"],
      ["100", "100.00"],
    ];
    for (const [input, canonical] of cases) {
      expect(formatPercentBp(parsePercentBp(input))).toBe(canonical);
    }
  });

  it("refuses anything that is not integer basis points", () => {
    expect(() => formatPercentBp(-1)).toThrow(/basis points/);
    expect(() => formatPercentBp(10_001)).toThrow(/basis points/);
    expect(() => formatPercentBp(12.5)).toThrow(/basis points/);
    expect(() => formatPercentBp(Number.NaN)).toThrow(/basis points/);
  });
});

describe("splitEvenlyCents — the equal-share primitive (project types, 0032)", () => {
  it("conserves the total to the cent and deals the residue in id order", () => {
    const out = splitEvenlyCents(100, ["c", "a", "b"]);
    expect([...out.entries()]).toEqual([
      ["a", 34],
      ["b", 33],
      ["c", 33],
    ]);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("splits exactly when the total divides evenly", () => {
    const out = splitEvenlyCents(90, ["m2", "m1", "m3"]);
    expect([...out.values()]).toEqual([30, 30, 30]);
  });

  it("dedupes ids so one member cannot be paid twice", () => {
    const out = splitEvenlyCents(10, ["a", "a", "b"]);
    expect([...out.entries()]).toEqual([
      ["a", 5],
      ["b", 5],
    ]);
  });

  it("zero total yields zero parts; an empty roster with money owed throws", () => {
    expect([...splitEvenlyCents(0, ["a", "b"]).values()]).toEqual([0, 0]);
    expect(() => splitEvenlyCents(100, [])).toThrow(/No participants/);
  });

  it("refuses non-integer or negative totals (never a fractional cent)", () => {
    expect(() => splitEvenlyCents(100.5, ["a"])).toThrow(/integer-cent/);
    expect(() => splitEvenlyCents(-1, ["a"])).toThrow(/integer-cent/);
  });
});
