import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHARE_VALUE_CENTS,
  resolveShareValueCents,
  assertIntegralShares,
  sharesToCents,
  sharesFromCents,
  proRataCents,
} from "./shares";

describe("resolveShareValueCents", () => {
  it("falls back to the 1000.00 default", () => {
    expect(resolveShareValueCents(null)).toBe(100_000);
    expect(resolveShareValueCents(undefined)).toBe(100_000);
    expect(resolveShareValueCents({})).toBe(DEFAULT_SHARE_VALUE_CENTS);
    expect(resolveShareValueCents({ shareValueBdt: null })).toBe(DEFAULT_SHARE_VALUE_CENTS);
    expect(resolveShareValueCents({ shareValueBdt: "" })).toBe(DEFAULT_SHARE_VALUE_CENTS);
  });

  it("parses decimal string and number settings exactly", () => {
    expect(resolveShareValueCents({ shareValueBdt: "1000" })).toBe(100_000);
    expect(resolveShareValueCents({ shareValueBdt: "1000.00" })).toBe(100_000);
    expect(resolveShareValueCents({ shareValueBdt: "2500.5" })).toBe(250_050);
    expect(resolveShareValueCents({ shareValueBdt: 12.34 })).toBe(1234);
  });

  it("rejects zero and negative share values", () => {
    expect(() => resolveShareValueCents({ shareValueBdt: "0" })).toThrow();
    expect(() => resolveShareValueCents({ shareValueBdt: 0 })).toThrow();
    expect(() => resolveShareValueCents({ shareValueBdt: "-5" })).toThrow();
    expect(() => resolveShareValueCents({ shareValueBdt: "0.001" })).toThrow(); // not 2dp
  });
});

describe("assertIntegralShares", () => {
  it("accepts non-negative integers", () => {
    expect(assertIntegralShares(0)).toBe(0);
    expect(assertIntegralShares(7)).toBe(7);
  });

  it("rejects fractions, negatives, and non-numbers", () => {
    expect(() => assertIntegralShares(1.5)).toThrow();
    expect(() => assertIntegralShares(-1)).toThrow();
    expect(() => assertIntegralShares("3" as unknown as number)).toThrow();
    expect(() => assertIntegralShares(NaN)).toThrow();
  });
});

describe("sharesToCents", () => {
  it("is an exact integer product (1 share = 1000.00)", () => {
    expect(sharesToCents(1, 100_000)).toBe(100_000);
    expect(sharesToCents(10, 100_000)).toBe(1_000_000);
    expect(sharesToCents(0, 100_000)).toBe(0);
    expect(sharesToCents(3, 250_050)).toBe(750_150);
  });

  it("rejects fractional shares and invalid share value", () => {
    expect(() => sharesToCents(1.5, 100_000)).toThrow();
    expect(() => sharesToCents(2, 0)).toThrow();
    expect(() => sharesToCents(2, -1)).toThrow();
  });
});

describe("sharesFromCents", () => {
  it("floors contributed money to whole shares", () => {
    expect(sharesFromCents(1_000_000, 100_000)).toBe(10);
    expect(sharesFromCents(1_500_000, 100_000)).toBe(15);
    expect(sharesFromCents(1_499_999, 100_000)).toBe(14); // floor, not round
    expect(sharesFromCents(99_999, 100_000)).toBe(0);
    expect(sharesFromCents(0, 100_000)).toBe(0);
  });

  it("returns 0 for a non-positive share value instead of dividing by zero", () => {
    expect(sharesFromCents(500_000, 0)).toBe(0);
  });

  it("rejects negative or fractional cent totals", () => {
    expect(() => sharesFromCents(-1, 100_000)).toThrow();
    expect(() => sharesFromCents(10.5, 100_000)).toThrow();
  });
});

describe("proRataCents", () => {
  it("floors each slice and never over-allocates the pool", () => {
    const a = proRataCents(1, 3, 10_000);
    const b = proRataCents(2, 3, 10_000);
    expect(a).toBe(3_333);
    expect(b).toBe(6_666);
    expect(a + b).toBeLessThanOrEqual(10_000);
  });

  it("returns the whole pool when one holder owns everything", () => {
    expect(proRataCents(5, 5, 123_456)).toBe(123_456);
  });

  it("returns 0 for a zero total or zero part", () => {
    expect(proRataCents(1, 0, 10_000)).toBe(0);
    expect(proRataCents(0, 5, 10_000)).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => proRataCents(-1, 5, 10_000)).toThrow();
    expect(() => proRataCents(1, -5, 10_000)).toThrow();
    expect(() => proRataCents(1, 5, -10_000)).toThrow();
    expect(() => proRataCents(1.5, 5, 10_000)).toThrow();
  });
});
