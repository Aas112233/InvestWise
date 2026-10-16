import { describe, expect, it } from "vitest";
import { translateLedgerDescription } from "./ledger-description";
import { createServerT } from "./reports/format";
import type { ReportLocale } from "./reports/catalog";
import en from "@/messages/en.json";
import bn from "@/messages/bn.json";
import hi from "@/messages/hi.json";
import ur from "@/messages/ur.json";

const LOCALES: ReportLocale[] = ["en", "bn", "hi", "ur"];
const DICTS: Record<ReportLocale, unknown> = { en, bn, hi, ur };

function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
    }
  } else if (typeof value === "string") {
    out[prefix] = value;
  }
  return out;
}

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}

/** Every narration form the write paths actually store. */
const SAMPLES = [
  "Equity Migration: Received from Mahmoud hassan Toha [Reference: dqf reqfv wf sfaafd]",
  "Equity Migration: Transferred to 1 recipient(s) [Reference: dqf reqfv wf sfaafd]",
  "Equity investment in project: general project (1 share @ 1000.00)",
  "Equity investment in project: general project (3 shares @ 1000.00)",
  "Statutory reserve (10.00%) for dividend run DIV-D4161CA9-180B-4ACD-B62B-6FCF6967CE13",
  "Statutory reserve sweep to Statutory Reserve Fund (10.00%) for dividend run DIV-D4161CA9",
  "Dividend distribution to 2 members",
  "Dividend payout for 2 shares",
  "Dividend payout for 1 shares",
  "Project profit return to general project Fund (general project): f3qfe",
  "Project profit return (general project): f3qfe",
  "Project loss absorption (general project): f3qfe",
  "[Transfer OUT] to Dividend & Profit Distribution Pool: earvaerva ear evz",
  "[Transfer IN] from general project Fund: earvaerva ear evz",
  "Opening Balance for reserve",
];

describe("translateLedgerDescription", () => {
  const enT = createServerT("en");
  const bnT = createServerT("bn");

  it("localizes an equity-migration receipt and keeps the interpolated data verbatim", () => {
    const out = translateLedgerDescription(
      "Equity Migration: Received from Mahmoud hassan Toha [Reference: dqf reqfv wf sfaafd]",
      bnT,
    );
    expect(out).not.toContain("Equity Migration");
    expect(out).toContain("Mahmoud hassan Toha");
    expect(out).toContain("dqf reqfv wf sfaafd");
  });

  it("uses the singular wrapper for a one-recipient transfer", () => {
    expect(
      translateLedgerDescription(
        "Equity Migration: Transferred to 1 recipient(s) [Reference: test]",
        enT,
      ),
    ).toBe("Equity Migration: Transferred to 1 recipient [Reference: test]");
  });

  it("pluralizes share counts (and repairs the stored `1 shares`)", () => {
    expect(translateLedgerDescription("Dividend payout for 1 shares", enT)).toBe(
      "Dividend payout for 1 share",
    );
    expect(translateLedgerDescription("Dividend payout for 5 shares", enT)).toBe(
      "Dividend payout for 5 shares",
    );
    expect(translateLedgerDescription("Dividend payout for 1 shares", bnT)).not.toContain("Dividend payout");
  });

  it("localizes the equity-investment narration", () => {
    const out = translateLedgerDescription(
      "Equity investment in project: general project (1 share @ 1000.00)",
      bnT,
    );
    expect(out).not.toContain("Equity investment");
    expect(out).toContain("general project");
    expect(out).toContain("1000.00");
  });

  it("localizes fund transfers, dividend-run rows, opening balances and project returns", () => {
    const out = translateLedgerDescription(
      "[Transfer OUT] to Dividend & Profit Distribution Pool: earvaerva ear evz",
      bnT,
    );
    expect(out).not.toContain("[Transfer OUT]");
    expect(out).toContain("Dividend & Profit Distribution Pool");
    expect(out).toContain("earvaerva ear evz");

    expect(
      translateLedgerDescription("Statutory reserve (10.00%) for dividend run DIV-1", bnT),
    ).not.toContain("Statutory reserve");
    expect(
      translateLedgerDescription(
        "Statutory reserve sweep to Statutory Reserve Fund (10.00%) for dividend run DIV-1",
        bnT,
      ),
    ).not.toContain("Statutory reserve sweep");
    expect(translateLedgerDescription("Dividend distribution to 2 members", bnT)).not.toContain(
      "Dividend distribution",
    );
    expect(translateLedgerDescription("Opening Balance for reserve", bnT)).not.toContain(
      "Opening Balance",
    );
    expect(
      translateLedgerDescription("Project profit return (general project): f3qfe", bnT),
    ).not.toContain("Project profit return");
    expect(
      translateLedgerDescription("Project loss absorption (general project): f3qfe", bnT),
    ).not.toContain("Project loss absorption");
  });

  it("handles an empty transfer note", () => {
    const out = translateLedgerDescription("[Transfer IN] from general project Fund: ", bnT);
    expect(out).not.toContain("[Transfer IN]");
    expect(out).toContain("general project Fund");
  });

  it("passes free-text narrations and unknown patterns through untouched", () => {
    expect(translateLedgerDescription("f3qfe", bnT)).toBe("f3qfe");
    expect(translateLedgerDescription("Member deposit", bnT)).toBe("Member deposit");
    expect(translateLedgerDescription("", bnT)).toBe("");
    expect(translateLedgerDescription(null, bnT)).toBe("");
    expect(translateLedgerDescription(undefined, bnT)).toBe("");
  });

  it("falls back to the stored text when the key is missing", () => {
    const raw = "Opening Balance for reserve";
    expect(translateLedgerDescription(raw, (key) => key)).toBe(raw);
  });

  it("translates every known narration in all four locales", () => {
    for (const locale of LOCALES) {
      const t = createServerT(locale);
      for (const sample of SAMPLES) {
        const out = translateLedgerDescription(sample, t);
        expect(out, `${locale} :: ${sample}`).not.toContain("ledger.");
        expect(out.length, `${locale} :: ${sample}`).toBeGreaterThan(0);
      }
    }
  });

  it("defines the ledger namespace identically across locales (key + placeholder parity)", () => {
    const reference = flatten((en as Record<string, unknown>).ledger);
    const referenceKeys = Object.keys(reference).sort();
    expect(referenceKeys.length).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      const dict = flatten((DICTS[locale] as Record<string, unknown>).ledger);
      expect(Object.keys(dict).sort(), locale).toEqual(referenceKeys);
      for (const key of referenceKeys) {
        const value = dict[key] ?? "";
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(reference[key] as string));
      }
    }
  });
});
