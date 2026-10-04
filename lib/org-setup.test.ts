import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_FISCAL_YEAR_END,
  DEFAULT_FISCAL_YEAR_START,
  DEFAULT_ORG_FUNDS,
  DEFAULT_SHARE_VALUE,
  MAX_EXTRA_FUNDS,
  normalizeExtraFunds,
  resolveFinancialDefaults,
} from "./org-setup";
import { ValidationError } from "./utils/errors";

describe("new-tenant financial defaults", () => {
  it("falls back to the documented platform defaults when nothing is sent", () => {
    expect(resolveFinancialDefaults()).toEqual({
      baseCurrency: DEFAULT_CURRENCY,
      dateFormat: DEFAULT_DATE_FORMAT,
      shareValue: DEFAULT_SHARE_VALUE,
      fiscalYearStart: DEFAULT_FISCAL_YEAR_START,
      fiscalYearEnd: DEFAULT_FISCAL_YEAR_END,
    });
  });

  it("treats an omitted field the same as an empty one", () => {
    expect(resolveFinancialDefaults({ baseCurrency: "", shareValue: undefined }).baseCurrency).toBe(DEFAULT_CURRENCY);
  });

  it("keeps money a 2dp string instead of a float", () => {
    expect(resolveFinancialDefaults({ shareValue: "1000" }).shareValue).toBe("1000.00");
    expect(resolveFinancialDefaults({ shareValue: " 12.50 " }).shareValue).toBe("12.50");
    expect(typeof resolveFinancialDefaults({ shareValue: "999.99" }).shareValue).toBe("string");
  });

  it("rejects amounts that cannot fit decimal(15,2) or are not positive", () => {
    for (const bad of ["1000.555", "0", "0.00", "-5", "abc", "1e3", "1,000"]) {
      expect(() => resolveFinancialDefaults({ shareValue: bad })).toThrow(ValidationError);
    }
  });

  it("rejects a number where a money string is required", () => {
    // 1000 as a number would reach Postgres as a float — the exact thing §12 forbids.
    expect(() => resolveFinancialDefaults({ shareValue: 1000 as unknown as string })).toThrow(ValidationError);
  });

  it("rejects a currency, date format or month outside the offered enumerations", () => {
    expect(() => resolveFinancialDefaults({ baseCurrency: "XYZ" })).toThrow(ValidationError);
    expect(() => resolveFinancialDefaults({ baseCurrency: "bdt" })).toThrow(ValidationError);
    expect(() => resolveFinancialDefaults({ dateFormat: "DD-MM-YYYY" })).toThrow(ValidationError);
    expect(() => resolveFinancialDefaults({ fiscalYearStart: "Jul" })).toThrow(ValidationError);
    expect(() => resolveFinancialDefaults({ fiscalYearEnd: "Month 4" })).toThrow(ValidationError);
  });

  it("requires a fiscal year that actually spans months", () => {
    expect(() =>
      resolveFinancialDefaults({ fiscalYearStart: "July", fiscalYearEnd: "July" }),
    ).toThrow(/differ/);
  });
});

describe("default institutional fund set", () => {
  it("uses only fund types the funds screen can edit", () => {
    // 'PROJECT' and 'Reserve' would be unselectable in the create/edit form,
    // locking the owner out of saving the row again.
    for (const fund of DEFAULT_ORG_FUNDS) {
      expect(["DEPOSIT", "PRIMARY", "OTHER"]).toContain(fund.type);
    }
  });

  it("is unique by name and by account suffix", () => {
    const names = DEFAULT_ORG_FUNDS.map((f) => f.name);
    const suffixes = DEFAULT_ORG_FUNDS.map((f) => f.accountSuffix);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it("carries no fixed account number, so two tenants cannot collide", () => {
    // funds.account_number is globally UNIQUE in the live database.
    for (const fund of DEFAULT_ORG_FUNDS) {
      expect(fund.accountSuffix).not.toMatch(/^IW-/);
    }
  });
});

describe("signup extra-funds validation", () => {
  it("adds nothing when no funds are sent (backward compatible with the default seed)", () => {
    expect(normalizeExtraFunds(undefined)).toEqual([]);
    expect(normalizeExtraFunds(null)).toEqual([]);
    expect(normalizeExtraFunds([])).toEqual([]);
  });

  it("accepts a bounded list of valid name + type rows", () => {
    const out = normalizeExtraFunds([
      { name: "  Scholarship Pool  ", type: "DEPOSIT" },
      { name: "Capex Fund", type: "PRIMARY" },
    ]);
    expect(out).toEqual([
      { name: "Scholarship Pool", type: "DEPOSIT" },
      { name: "Capex Fund", type: "PRIMARY" },
    ]);
  });

  it("rejects more than MAX_EXTRA_FUNDS rows", () => {
    const many = Array.from({ length: MAX_EXTRA_FUNDS + 1 }, (_, i) => ({ name: `Fund ${i}`, type: "OTHER" }));
    expect(() => normalizeExtraFunds(many)).toThrow(ValidationError);
  });

  it("rejects an off-enum type and a too-short name", () => {
    expect(() => normalizeExtraFunds([{ name: "Real Fund", type: "PROJECT" }])).toThrow(ValidationError);
    expect(() => normalizeExtraFunds([{ name: "x", type: "OTHER" }])).toThrow(ValidationError);
  });

  it("rejects a non-list payload rather than throwing a TypeError", () => {
    expect(() => normalizeExtraFunds({ name: "Nope", type: "OTHER" })).toThrow(ValidationError);
  });
});
