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
  /** Resolve an i18n path; falls back to the English dictionary, then the path itself. */
  (path: string): string;
  locale: ReportLocale;
}

export function createServerT(locale: ReportLocale): ServerT {
  const t = (path: string): string => {
    const value = lookup(DICTS[locale], path) ?? lookup(en, path);
    return typeof value === "string" ? value : path;
  };
  t.locale = locale;
  return t;
}

/** Format a UTC timestamp against a tenant `DD/MM/YYYY` (+ optional `HH:mm`) pattern (Rule §8). */
export function formatUtcDate(
  value: string | Date | null | undefined,
  pattern: string = "DD/MM/YYYY",
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return pattern
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", year)
    .replace("HH", hours)
    .replace("mm", minutes);
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
