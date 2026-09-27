/**
 * Canonical share-number / share-value conversions.
 *
 * One share is worth `system_settings.share_value_bdt` (default 1000.00 BDT).
 * Share counts are integers (DB `integer` columns) and are ONE-TIME SETUP:
 * they are set at member creation and never change via deposits. The only
 * legitimate mutations are ownership events (equity transfer, exit settlement)
 * which conserve the total.
 *
 * All money amounts here are integer cents (see ./money). Never floats.
 */
import { MoneyError, toCents } from "./money";

export const DEFAULT_SHARE_VALUE_CENTS = 100_000; // 1000.00 BDT per share

export interface ShareValueSource {
  shareValueBdt?: string | number | null;
}

/** Convert a settings row's shareValueBdt into positive integer cents. */
export function resolveShareValueCents(settings?: ShareValueSource | null): number {
  const raw = settings?.shareValueBdt;
  const cents =
    raw === null || raw === undefined || raw === ""
      ? DEFAULT_SHARE_VALUE_CENTS
      : toCents(raw);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new MoneyError("Share value must be a positive amount", "INVALID_SHARE_VALUE");
  }
  return cents;
}

/** Validate an API-supplied share count: non-negative integer. Returns the value. */
export function assertIntegralShares(value: unknown, field = "shares"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MoneyError(`${field} must be a non-negative integer`, "INVALID_SHARES");
  }
  return value;
}

/** Money (cents) a share count is worth: exact integer product. */
export function sharesToCents(shares: number, shareValueCents: number): number {
  assertIntegralShares(shares);
  if (!Number.isInteger(shareValueCents) || shareValueCents <= 0) {
    throw new MoneyError("Share value cents must be a positive integer", "INVALID_SHARE_VALUE");
  }
  return shares * shareValueCents;
}

/** Whole shares derived from a money amount: floor(contributed / shareValue). */
export function sharesFromCents(totalCents: number, shareValueCents: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new MoneyError("Total cents must be a non-negative integer", "INVALID_AMOUNT");
  }
  if (!Number.isInteger(shareValueCents) || shareValueCents <= 0) return 0;
  return Math.floor(totalCents / shareValueCents);
}

/** Pro-rata slice of a cents pool, floored to whole cents (remainder stays unallocated). */
export function proRataCents(part: number, total: number, totalCents: number): number {
  if (!Number.isInteger(part) || part < 0) {
    throw new MoneyError("part must be a non-negative integer", "INVALID_SHARES");
  }
  if (!Number.isInteger(total) || total < 0) {
    throw new MoneyError("total must be a non-negative integer", "INVALID_SHARES");
  }
  if (total === 0) return 0;
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new MoneyError("Total cents must be a non-negative integer", "INVALID_AMOUNT");
  }
  return Math.floor((totalCents * part) / total);
}
