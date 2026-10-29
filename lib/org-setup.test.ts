import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_DEPOSIT_SCHEDULE,
  DEFAULT_FISCAL_YEAR_END,
  DEFAULT_FISCAL_YEAR_START,
  DEFAULT_ORG_FUNDS,
  DEFAULT_SHARE_VALUE,
  CURRENCIES,
  DEPOSIT_SCHEDULES,
  DEPOSIT_SCHEDULE_VALUES,
  MAX_EXTRA_FUNDS,
  normalizeExtraFunds,
  resolveFinancialDefaults,
} from "./org-setup";
import { DEPOSIT_SCHEDULE } from "@/lib/deposit-schedule/schedule";
import { toCents } from "./money";
import { ValidationError } from "./utils/errors";

describe("new-tenant financial defaults", () => {
  it("falls back to the documented platform defaults when nothing is sent", () => {
    expect(resolveFinancialDefaults()).toEqual({
      baseCurrency: DEFAULT_CURRENCY,
      dateFormat: DEFAULT_DATE_FORMAT,
      shareValue: DEFAULT_SHARE_VALUE,
      fiscalYearStart: DEFAULT_FISCAL_YEAR_START,
      fiscalYearEnd: DEFAULT_FISCAL_YEAR_END,
      // Added with the deposit-model choice: an onboarding client that predates it still gets
      // monthly, which is the model every existing tenant runs.
      depositSchedule: DEFAULT_DEPOSIT_SCHEDULE,
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

  describe("deposit model chosen at signup", () => {
    it("keeps an explicit flexible choice instead of overwriting it with the default", () => {
      // The whole point of the signup option: if provisioning re-derived monthly, a tenant could
      // pay for flexible onboarding and get the month lock anyway.
      expect(resolveFinancialDefaults({ depositSchedule: "flexible" }).depositSchedule).toBe(
        DEPOSIT_SCHEDULE.FLEXIBLE,
      );
      expect(resolveFinancialDefaults({ depositSchedule: "monthly" }).depositSchedule).toBe(
        DEPOSIT_SCHEDULE.MONTHLY,
      );
    });

    it("rejects a schedule it does not offer, rather than quietly defaulting it", () => {
      // Monthly-on-junk is right for a STORED value the runtime resolver reads, but here it would
      // hide a client bug behind a deposit model nobody picked.
      expect(() => resolveFinancialDefaults({ depositSchedule: "FLEXIBLE" })).toThrow(ValidationError);
      expect(() => resolveFinancialDefaults({ depositSchedule: "anytime" })).toThrow(ValidationError);
      // Whitespace is NOT the same as "not asked": textOr only falls back for absent/empty, so a
      // blank-but-present value is a client bug and stays a 400.
      expect(() => resolveFinancialDefaults({ depositSchedule: " " })).toThrow(ValidationError);
      expect(resolveFinancialDefaults({ depositSchedule: "" }).depositSchedule).toBe(
        DEFAULT_DEPOSIT_SCHEDULE,
      );
      // Surrounding space is trimmed BEFORE the vocabulary check, like every other field here, so
      // " flexible " is a valid choice rather than a 400. Case is still significant: the column,
      // the resolver and the Settings screen all spell the value lowercase.
      expect(resolveFinancialDefaults({ depositSchedule: " flexible " }).depositSchedule).toBe("flexible");
      expect(() => resolveFinancialDefaults({ depositSchedule: 1 as unknown as string })).toThrow(
        ValidationError,
      );
      expect(() => resolveFinancialDefaults({ depositSchedule: "anytime" })).toThrow(
        /\[Field 'depositSchedule', Code: invalid_schedule\]/,
      );
    });

    it("offers both models with the wording the Settings screen uses for the same setting", () => {
      // One vocabulary, one wording: signup must not invent a third name for the model a tenant
      // later changes in Settings > Governance.
      expect(DEPOSIT_SCHEDULE_VALUES).toEqual(["monthly", "flexible"]);
      expect(DEPOSIT_SCHEDULES.map((s) => s.value)).toEqual(DEPOSIT_SCHEDULE_VALUES);
      for (const option of DEPOSIT_SCHEDULES) {
        expect(option.labelKey).toMatch(/^settings\.governance\.depositScheduleValue\./);
        expect(option.hintKey).toMatch(/^settings\.governance\.depositScheduleHint\./);
      }
      expect(DEFAULT_DEPOSIT_SCHEDULE).toBe(DEPOSIT_SCHEDULE.MONTHLY);
    });
  });
});

describe("offered currencies", () => {
  it("offers only codes the money layer and Intl can both handle", () => {
    for (const { value, label } of CURRENCIES) {
      // 3 letters: server/src/modules/funds/validation.ts only accepts a 3-letter code.
      expect(value).toMatch(/^[A-Z]{3}$/);
      expect(label.startsWith(`${value} `)).toBe(true);
      // A code Intl rejects does not fail loudly — lib/formatters.ts catches the RangeError and
      // prints "XX 1,234.56", so every amount in the app silently loses its symbol.
      expect(() =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: value }).format(1),
      ).not.toThrow();
      expect(resolveFinancialDefaults({ baseCurrency: value }).baseCurrency).toBe(value);
    }
    expect(new Set(CURRENCIES.map((c) => c.value)).size).toBe(CURRENCIES.length);
  });

  it("offers SAR plus the wider GCC, South-Asian and major-market set", () => {
    for (const code of [
      "BDT", "PKR", "INR", "USD", "AED", "GBP", // the original six
      "SAR", "QAR", "YER", "JOD", "LBP", "EGP", "TRY", "NPR", "LKR", "MYR", "SGD", "CNY", "EUR",
      "CAD", "AUD",
    ]) {
      expect(CURRENCIES.map((c) => c.value)).toContain(code);
    }
    // Still the platform default, so an existing tenant's display money is unchanged.
    expect(DEFAULT_CURRENCY).toBe("BDT");
  });

  it("refuses to offer a currency whose minor unit is 1/1000", () => {
    // decimal(15,2) plus `const CENTS = 100` in lib/money.ts cannot hold 1.234 KWD: toCents throws
    // PRECISION_LOSS. A society on such a currency would either be unable to record a real deposit
    // or would be told it received a rounded figure. Supporting them means changing the money model,
    // not appending to this list — this test exists so nobody "completes the GCC set" by mistake.
    for (const excluded of ["KWD", "BHD", "OMR", "TND", "MRU", "CLF", "MTZ"]) {
      expect(CURRENCIES.map((c) => c.value)).not.toContain(excluded);
    }
    // Both money.ts messages mention "decimal": the string path fails the DEC15_2 pattern, the
    // number path fails the float-precision guard. Either way 1.234 cannot become cents.
    expect(() => toCents("1.234")).toThrow(/decimal/i);
    expect(() => toCents(1.234)).toThrow(/decimal/i);
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
