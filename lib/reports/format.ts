/**
 * Server-side rendering utilities for generated report documents:
 * localized string lookup over the 4-locale message dictionaries (Rule §9/§10),
 * UTC-safe tenant-format dates (Rule §8), and exact money formatting on top of
 * integer cents from lib/money (Rule §12 — never float arithmetic).
 */
import en from "../../messages/en.json";
import ur from "../../messages/ur.json";
import hi from "../../messages/hi.json";
import bn from "../../messages/bn.json";
import { fromCents, sumCents, toCents } from "@/lib/money";
import type { ReportLocale } from "./catalog";

const DICTS: Record<ReportLocale, unknown> = { en, ur, hi, bn };

// The dictionaries use locale digit sets (۵,۰۰۰ / ५,००० / ৫,০০০) in their
// numeric text — interpolated values must be converted to match.
const DIGIT_SETS: Record<ReportLocale, string> = {
  en: "0123456789",
  ur: "۰۱۲۳۴۵۶۷۸۹",
  hi: "०१२३४५६७८९",
  bn: "০১২৩৪৫৬৭৮৯",
};

function toLocaleDigits(value: string | number, locale: ReportLocale): string {
  const s = String(value);
  if (locale === "en") return s;
  const set = DIGIT_SETS[locale];
  return s.replace(/[0-9]/g, (d) => set.charAt(Number(d)) || d);
}

function lookup(dict: unknown, path: string): unknown {
  let current: unknown = dict;
  for (const key of path.split(".")) {
    if (current !== null && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

export interface ServerT {
  /**
   * Resolve an i18n path; falls back to the English dictionary, then the path
   * itself. `vars` interpolates `{name}` placeholders (same syntax the client
   * useLocale t() uses, so a key can serve both sides).
   */
  (path: string, vars?: Record<string, string | number>): string;
  locale: ReportLocale;
}

export function createServerT(locale: ReportLocale): ServerT {
  const t = (path: string, vars?: Record<string, string | number>): string => {
    let value: unknown = lookup(DICTS[locale], path) ?? lookup(en, path);
    if (typeof value === "string" && vars) {
      let text = value;
      for (const [k, v] of Object.entries(vars)) {
        text = text.split(`{${k}}`).join(toLocaleDigits(v, locale));
      }
      value = text;
    }
    return typeof value === "string" ? value : path;
  };
  t.locale = locale;
  return t;
}

// Date tokens, LONGEST FIRST — a naive `.replace("MM", …)` chain corrupts any
// pattern that contains "MMM"/"MM" as a substring of a longer token.
const DATE_TOKENS: Array<[string, (d: Date) => string]> = [
  ["YYYY", (d) => String(d.getUTCFullYear())],
  ["DD", (d) => String(d.getUTCDate()).padStart(2, "0")],
  ["HH", (d) => String(d.getUTCHours()).padStart(2, "0")],
  ["mm", (d) => String(d.getUTCMinutes()).padStart(2, "0")],
  ["MM", (d) => String(d.getUTCMonth() + 1).padStart(2, "0")],
  ["M", (d) => String(d.getUTCMonth() + 1)],
  ["D", (d) => String(d.getUTCDate())],
];

/** Format a UTC timestamp against a tenant `DD/MM/YYYY` (+ optional `HH:mm`) pattern (Rule §8). */
export function formatUtcDate(
  value: string | Date | null | undefined,
  pattern: string = "DD/MM/YYYY",
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const token = DATE_TOKENS.find(([t]) => pattern.startsWith(t, i));
    if (token) {
      out += token[1](date);
      i += token[0].length;
    } else {
      out += pattern.charAt(i);
      i += 1;
    }
  }
  return out;
}

/** Localized month name for a `YYYY-MM` key. */
export function monthKeyLabel(monthKey: string, t: ServerT): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const monthIndex = Number(match[2]) - 1;
  const names = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ] as const;
  const name = t(`common.months.${names[monthIndex] ?? "jan"}`);
  return `${name} ${match[1]}`;
}

/** Group an integer string with thousands separators — no float round-trip. */
function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a decimal(15,2) string for display: `1234567.5` -> `1,234,567.50`.
 * Accepts numbers that are already 2dp-safe (e.g. percentage values).
 */
export function formatMoneyNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  let intPart: string;
  let fracPart: string;
  let negative = false;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    negative = value < 0;
    const fixed = Math.abs(value).toFixed(2);
    const [i, f] = fixed.split(".");
    intPart = i as string;
    fracPart = f as string;
  } else {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return "";
    negative = trimmed.startsWith("-");
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const [i, f = ""] = unsigned.split(".");
    intPart = i || "0";
    fracPart = f.padEnd(2, "0").slice(0, 2);
  }
  return `${negative ? "-" : ""}${groupDigits(intPart)}.${fracPart}`;
}

/** Currency-prefixed money for summary lines: `BDT 1,234.56`. */
export function formatMoneyWithCurrency(
  value: string | number | null | undefined,
  currency: string,
): string {
  const num = formatMoneyNumber(value);
  if (!num) return "";
  return `${currency} ${num}`;
}

/** Exact sum of decimal(15,2) strings via integer cents. */
export function sumDecimal(values: Array<string | number | null | undefined>): string {
  return fromCents(sumCents(values.map((v) => toCents(v ?? "0"))));
}

/** Parse a decimal(15,2) string to integer cents (null-safe, `0` for empty). */
export function decimalToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  return toCents(value);
}

/**
 * Table totals row for one column (client-safe: the #32 in-app viewer sums
 * the listed rows this way when the document carries no full-set total for
 * the column). Money sums through integer cents; number columns sum directly.
 */
export function totalForColumn(
  rows: Record<string, string | number | null>[],
  key: string,
  type: string,
): string {
  if (type === "money") {
    let cents = 0;
    for (const row of rows) {
      const raw = row[key];
      if (raw === null || raw === undefined || raw === "") continue;
      cents += Math.round(Number(raw) * 100);
    }
    return (cents / 100).toFixed(2);
  }
  if (type === "number") {
    let sum = 0;
    for (const row of rows) {
      const raw = row[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) sum += parsed;
    }
    return String(sum);
  }
  return "";
}
