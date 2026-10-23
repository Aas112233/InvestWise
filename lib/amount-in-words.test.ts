import { describe, expect, it } from "vitest";
import { amountInWords } from "./amount-in-words";

describe("amountInWords", () => {
  it("spells whole taka with the South-Asian scale", () => {
    expect(amountInWords("0")).toBe("zero taka only");
    expect(amountInWords("15")).toBe("fifteen taka only");
    expect(amountInWords("1000")).toBe("one thousand taka only");
    expect(amountInWords("1500")).toBe("one thousand five hundred taka only");
    expect(amountInWords("100000")).toBe("one lakh taka only");
    expect(amountInWords("150000")).toBe("one lakh fifty thousand taka only");
    expect(amountInWords("10000000")).toBe("one crore taka only");
    expect(amountInWords("15250000")).toBe("one crore fifty-two lakh fifty thousand taka only");
  });

  it("keeps poisha and tolerates formatted input", () => {
    expect(amountInWords("15000.5")).toBe("fifteen thousand taka and fifty poisha only");
    expect(amountInWords("15000.01")).toBe("fifteen thousand taka and one poisha only");
    expect(amountInWords("1,50,000")).toBe("one lakh fifty thousand taka only");
  });

  it("rounds to the paisa before splitting the amount", () => {
    // 0.999 must not become "zero taka and ninety-nine poisha".
    expect(amountInWords("0.999")).toBe("one taka only");
  });

  it("marks a reversal as negative rather than dropping the sign", () => {
    expect(amountInWords("-250")).toBe("minus two hundred and fifty taka only");
  });

  it("returns null for anything unusable so the line is omitted, not invented", () => {
    expect(amountInWords(null)).toBeNull();
    expect(amountInWords(undefined)).toBeNull();
    expect(amountInWords("")).toBeNull();
    expect(amountInWords("abc")).toBeNull();
    expect(amountInWords(Number.NaN)).toBeNull();
  });
});
