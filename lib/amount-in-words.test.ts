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

  /**
   * The line above the signature on a printed receipt is the tamper evidence, so naming the wrong
   * unit is not a cosmetic defect. These pin that the sentence follows the tenant's currency.
   */
  describe("currency-awareness", () => {
    it("defaults to BDT so an existing call site prints exactly what it printed before", () => {
      // The four document components gained their currency argument later; a call site that has not
      // caught up yet must still print taka rather than the wrong unit, never a blank line.
      expect(amountInWords("1500")).toBe(amountInWords("1500", "BDT"));
      expect(amountInWords("1500", null)).toBe("one thousand five hundred taka only");
      expect(amountInWords("1500", "  ")).toBe("one thousand five hundred taka only");
    });

    it("names the currency the label carries", () => {
      expect(amountInWords("1500", "SAR")).toBe("one thousand five hundred saudi riyal only");
      expect(amountInWords("1000000", "USD")).toBe("one million us dollar only");
      expect(amountInWords("250", "GBP")).toBe("two hundred and fifty pound sterling only");
      expect(amountInWords("50", "AED")).toBe("fifty uae dirham only");
    });

    it("groups by the market's own scale, not one global scale", () => {
      // A voucher written in lakh must not be spelled out in millions, or the words contradict
      // the figures directly above them.
      expect(amountInWords("150000", "PKR")).toBe("one lakh fifty thousand pakistani rupee only");
      expect(amountInWords("150000", "INR")).toBe("one lakh fifty thousand indian rupee only");
      expect(amountInWords("150000", "SAR")).toBe("one hundred and fifty thousand saudi riyal only");
      expect(amountInWords("150000", "USD")).toBe("one hundred and fifty thousand us dollar only");
    });

    it("writes the subunit as a fraction for every currency but BDT", () => {
      // "halala", "fils", "paisa", "sen"… are all real, but this codebase has never asserted them
      // per currency. An invented noun on a legal document is worse than the neutral /100 that
      // every market reads correctly — and BDT keeps the word its receipts have always used.
      expect(amountInWords("15000.5", "SAR")).toBe("fifteen thousand saudi riyal and 50/100 only");
      expect(amountInWords("0.05", "EUR")).toBe("zero euro and 05/100 only");
      expect(amountInWords("15000.5", "BDT")).toBe("fifteen thousand taka and fifty poisha only");
      expect(amountInWords("1.01", "QAR")).toContain("1/100");
    });

    it("never falls back to taka for a currency it does not know", () => {
      // A tenant whose stored code is outside the offered list gets the bare code — bland, but
      // never the wrong currency's name.
      expect(amountInWords("5", "XBT")).toBe("five xbt only");
      expect(amountInWords("5", "taka")).toBe("five taka only");
      expect(amountInWords("5", "SAR")).not.toContain("taka");
    });
  });
});
