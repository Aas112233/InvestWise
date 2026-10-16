import { describe, it, expect } from "vitest";
import { blocksNumericKey, sanitizeNumericPaste } from "./numeric-input";

/** Minimal stand-in for the parts of a KeyboardEvent the guard reads. */
function keyEvent(
  k: string,
  { value = "", selectionStart = 0 }: { value?: string; selectionStart?: number } = {},
) {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    currentTarget: { value, selectionStart } as HTMLInputElement,
  };
}

describe("blocksNumericKey", () => {
  it("allows digits, navigation and shortcuts", () => {
    expect(blocksNumericKey(keyEvent("5"))).toBe(false);
    expect(blocksNumericKey(keyEvent("Backspace"))).toBe(false);
    expect(blocksNumericKey(keyEvent("ArrowLeft"))).toBe(false);
    expect(blocksNumericKey({ ...keyEvent("a"), ctrlKey: true })).toBe(false);
  });

  it("blocks letters and scientific-notation characters", () => {
    for (const k of ["a", "e", "E", "+", " ", "$", "%"]) {
      expect(blocksNumericKey(keyEvent(k))).toBe(true);
    }
  });

  it("allows a single decimal point only", () => {
    expect(blocksNumericKey(keyEvent("."))).toBe(false);
    expect(blocksNumericKey(keyEvent(".", { value: "1.2" }))).toBe(true);
    expect(blocksNumericKey(keyEvent("."), { allowDecimal: false })).toBe(true);
  });

  it("blocks a comma — the app uses '.' as the decimal separator", () => {
    expect(blocksNumericKey(keyEvent(","))).toBe(true);
  });

  it("allows a leading minus only when negatives are in range", () => {
    expect(blocksNumericKey(keyEvent("-"), { min: 0 })).toBe(true);
    expect(blocksNumericKey(keyEvent("-"), { min: 0.01 })).toBe(true);
    expect(blocksNumericKey(keyEvent("-"), {})).toBe(false);
    expect(blocksNumericKey(keyEvent("-", { value: "12", selectionStart: 2 }), {})).toBe(true);
    expect(blocksNumericKey(keyEvent("-", { value: "-1", selectionStart: 0 }), {})).toBe(true);
  });
});

describe("sanitizeNumericPaste", () => {
  it("strips non-numeric characters", () => {
    expect(sanitizeNumericPaste("abc")).toBe("");
    expect(sanitizeNumericPaste("12abc34")).toBe("1234");
  });

  it("drops grouping separators", () => {
    expect(sanitizeNumericPaste("1,000.50")).toBe("1000.50");
    expect(sanitizeNumericPaste("1,234")).toBe("1234");
  });

  it("reads a lone trailing comma with 1-2 digits as a decimal point", () => {
    expect(sanitizeNumericPaste("1000,50")).toBe("1000.50");
    expect(sanitizeNumericPaste("10,5")).toBe("10.5");
  });

  it("keeps only the first decimal point", () => {
    expect(sanitizeNumericPaste("a1,2b3.4.5x")).toBe("123.45");
    expect(sanitizeNumericPaste("1.2.3")).toBe("1.23");
  });

  it("handles the sign according to the range", () => {
    expect(sanitizeNumericPaste("-12.5")).toBe("-12.5");
    expect(sanitizeNumericPaste("-12.5", { min: 0 })).toBe("12.5");
    expect(sanitizeNumericPaste("1-2-3")).toBe("123");
  });

  it("removes the decimal point entirely when decimals are disallowed", () => {
    expect(sanitizeNumericPaste("12.5", { allowDecimal: false })).toBe("125");
  });
});

