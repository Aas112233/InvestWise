import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  parsePositiveAmount,
  sumCents,
  splitDividendByShares,
  splitByPercent,
  parsePercentBp,
  parseDepositMonthToIso,
  roundToCents,
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
