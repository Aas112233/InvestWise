/**
 * Amount in words for printed financial documents.
 *
 * A numeric-only amount is the cheapest thing to alter on a printed or edited
 * sheet (1,50,000 → 15,00,000), so the words line is the tamper evidence a
 * receipt carries. That is also why this file is currency-aware: a sentence
 * about the wrong unit is not a cosmetic defect on a document whose whole job
 * is to be checkable. Three things vary by currency —
 *
 *  1. the unit noun, taken from the SAME label the currency picker shows
 *     ("SAR — Saudi Riyal" → "saudi riyal"), so a new entry in CURRENCIES can
 *     never arrive here without one;
 *  2. the grouping scale: South-Asian markets write lakh/crore on vouchers and
 *     the words have to match the figures above them, everyone else writes
 *     thousand/million/billion;
 *  3. the subunit. Only BDT has a verified English subunit noun in this codebase
 *     (poisha, and existing receipts print it in words). Rather than invent a
 *     noun per currency — a wrong one is worse than a neutral one on a legal
 *     document — every other currency uses the international cheque fraction,
 *     "and 50/100", which is unambiguous in every market.
 *
 * ponytail: English words only, as before. The digit words are computed, not UI
 * copy, so the 4-locale rule applies to the label, not the figure.
 * Upgrade path: localise ONES/TENS and the scale nouns per locale, behind the
 * same signature.
 */
import { CURRENCIES } from "./org-setup";

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Currencies whose vouchers are written in lakh/crore. Grouping the words
 * differently from the figures above them would make a receipt look altered.
 */
const SOUTH_ASIAN_GROUPING = new Set(["BDT", "PKR", "INR", "NPR", "LKR"]);

/** The only subunit noun this codebase has ever asserted. Everything else uses /100. */
const SPOKEN_SUBUNIT = new Map([["BDT", "poisha"]]);

const DEFAULT_CURRENCY = "BDT";

/**
 * Unit nouns that must not be taken from the picker label. "BDT — Bangladeshi Taka"
 * would spell "bangladeshi taka", which appears on no voucher — and the BDT wording is
 * pinned by lib/amount-in-words.test.ts, so receipts printed for years would change
 * under an existing tenant. This is the only override; every other currency takes its
 * ISO English name, which is unambiguous on a document.
 */
const UNIT_OVERRIDE = new Map([["BDT", "taka"]]);

/**
 * "SAR — Saudi Riyal" → "saudi riyal". Falls back to the bare code for a currency
 * outside the offered list: printing "usd" is bland, printing "taka" for a dollar
 * is wrong, and silence would be worst.
 */
function unitNounFor(currency: string): string {
  const override = UNIT_OVERRIDE.get(currency);
  if (override) return override;
  const entry = CURRENCIES.find((c) => c.value === currency);
  // Split on the dash SEPARATING code from name, whatever dash character the label
  // uses (en dash, em dash or hyphen) — matching one literal dash would silently
  // fall back to the bare code the moment someone restyles a label.
  const name = (entry?.label ?? "").split(/\s[-\u2013\u2014]\s/)[1] ?? "";
  return name.trim().toLowerCase() || currency.toLowerCase();
}

/** 0..999 → English words, "and" between hundred and the rest as idiom requires. */
function under1000(n: number): string {
  if (n < 20) return ONES[n] ?? "zero";
  if (n < 100) {
    const ten = TENS[Math.floor(n / 10)] ?? "";
    const rest = n % 10;
    return rest === 0 ? ten : `${ten}-${ONES[rest] ?? ""}`;
  }
  const rest = n % 100;
  return rest === 0
    ? `${ONES[Math.floor(n / 100)]} hundred`
    : `${ONES[Math.floor(n / 100)]} hundred and ${under1000(rest)}`;
}

/** South-Asian grouping: arab, crore, lakh, thousand, then the last three digits. */
function southAsianInWords(amount: number, unit: string): string {
  if (amount === 0) return `zero ${unit}`;
  let remaining = amount;
  const parts: string[] = [];
  const take = (divisor: number, scale: string) => {
    const group = Math.floor(remaining / divisor);
    remaining %= divisor;
    if (group > 0) parts.push(scale ? `${under1000(group)} ${scale}` : under1000(group));
  };
  take(1_00_00_00_000, "arab");
  take(1_00_00_000, "crore");
  take(1_00_000, "lakh");
  take(1_000, "thousand");
  take(1, "");
  return `${parts.join(" ")} ${unit}`;
}

/** Western grouping: trillion, billion, million, thousand, then the last three digits. */
function westernInWords(amount: number, unit: string): string {
  if (amount === 0) return `zero ${unit}`;
  let remaining = amount;
  const parts: string[] = [];
  const take = (divisor: number, scale: string) => {
    const group = Math.floor(remaining / divisor);
    remaining %= divisor;
    if (group > 0) parts.push(scale ? `${under1000(group)} ${scale}` : under1000(group));
  };
  take(1_000_000_000_000, "trillion");
  take(1_000_000_000, "billion");
  take(1_000_000, "million");
  take(1_000, "thousand");
  take(1, "");
  return `${parts.join(" ")} ${unit}`;
}

function wholeInWords(amount: number, currency: string, unit: string): string {
  return SOUTH_ASIAN_GROUPING.has(currency)
    ? southAsianInWords(amount, unit)
    : westernInWords(amount, unit);
}

/**
 * "15000.5" → "fifteen thousand taka and fifty poisha only" (BDT, unchanged) and
 * "1500000.5" → "fifteen lakh nepalese rupee and 50/100 only" for a currency whose
 * subunit noun is not asserted here.
 *
 * `currency` defaults to BDT so every existing call site keeps printing exactly
 * what it printed before this was currency-aware.
 * Returns null for non-finite values so the caller can omit the line instead of
 * printing a sentence about an unusable amount.
 */
export function amountInWords(
  amount: number | string | null | undefined,
  currency?: string | null,
): string | null {
  // A blank string coerces to 0 in Number(), which would print "zero taka" on a
  // document whose amount was simply not supplied.
  if (typeof amount === "string" && amount.trim() === "") return null;
  const value = typeof amount === "string" ? Number(amount.replace(/[, ]/g, "")) : amount;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const code = (currency ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const unit = unitNounFor(code);

  const negative = value < 0;
  const abs = Math.abs(value);
  // Round to the subunit first, then split — otherwise 0.999 renders as
  // "zero taka and ninety-nine poisha".
  const cents = Math.round(abs * 100);
  const whole = Math.floor(cents / 100);
  const sub = cents % 100;
  const prefix = wholeInWords(whole, code, unit);

  let words: string;
  const spoken = SPOKEN_SUBUNIT.get(code);
  if (sub === 0) {
    words = `${prefix} only`;
  } else if (spoken) {
    const subWords = sub === 1 ? "one" : under1000(sub);
    words = `${prefix} and ${subWords} ${spoken} only`;
  } else {
    // Fraction style keeps a leading zero (05/100), which is how a clerk reads
    // five subunits rather than fifty.
    words = `${prefix} and ${String(sub).padStart(2, "0")}/100 only`;
  }
  return negative ? `minus ${words}` : words;
}
