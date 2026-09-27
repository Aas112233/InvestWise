/**
 * Money math — integer-cents core. NEVER use float arithmetic for money.
 *
 * Every monetary value crossing the DB boundary is a `decimal(15,2)` string.
 * Internally we always compute in integer cents; all helpers here round
 * half-away-from-zero at 2dp and reject non-finite input.
 *
 * Server-side the same discipline is enforced by Postgres `decimal(15,2)`
 * columns and numeric SQL updates; client-side totals are display-only.
 */

const CENTS = 100;
const MAX_AMOUNT = 10_000_000; // matches server validation ceiling
const DEC15_2 = /^-?\d{1,13}(\.\d{1,2})?$/;

export class MoneyError extends Error {
  code: string;
  constructor(message: string, code = "MONEY_ERROR") {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/** Parse a decimal(15,2) string (or finite number) into integer cents. */
export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MoneyError("Non-finite amount");
    // Guard the float path: only accept values that are already safe at 2dp
    const rounded = Math.round(value * CENTS);
    if (Math.abs(value * CENTS - rounded) > 1e-6) {
      throw new MoneyError("Amount has more than 2 decimal places", "PRECISION_LOSS");
    }
    return rounded;
  }
  const trimmed = value.trim();
  if (!DEC15_2.test(trimmed)) {
    throw new MoneyError(`Invalid decimal(15,2) value: "${value}"`, "INVALID_DECIMAL");
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const fracCents = Number(fracPart.padEnd(2, "0").slice(0, 2) || "0");
  const cents = Number(intPart) * CENTS + fracCents;
  return negative ? -cents : cents;
}

/** Format integer cents back to a decimal(15,2) string. */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new MoneyError("Cents value must be an integer");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = String(Math.floor(abs / CENTS));
  const frac = String(abs % CENTS).padStart(2, "0");
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}

/** Round any finite number to integer cents, half-away-from-zero. */
export function roundToCents(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyError("Non-finite amount");
  return value >= 0
    ? Math.floor(value * CENTS + 0.5)
    : Math.ceil(value * CENTS - 0.5);
}

/** Sum integer cents exactly. */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => {
    if (!Number.isInteger(v)) throw new MoneyError("sumCents expects integer cents");
    return acc + v;
  }, 0);
}

/**
 * Validate a transaction amount server-side: must be > 0, at most 2dp,
 * within the configured ceiling. Returns integer cents.
 */
export function parsePositiveAmount(
  value: string | number,
  { minCents = 1, maxCents = MAX_AMOUNT * CENTS, field = "amount" } = {},
): number {
  const cents = toCents(value);
  if (!Number.isInteger(cents)) throw new MoneyError(`${field} precision error`, "PRECISION_LOSS");
  if (cents < minCents) throw new MoneyError(`${field} must be greater than zero`, "INVALID_AMOUNT");
  if (cents > maxCents) throw new MoneyError(`${field} exceeds the maximum allowed`, "AMOUNT_TOO_LARGE");
  return cents;
}

/**
 * Shares-weighted dividend split in exact cents.
 * Deterministic largest-remainder method: every recipient gets floor-based
 * cents, leftovers are handed out one cent at a time to the highest
 * fractional remainder (ties broken by lower member id for determinism).
 * Guarantees sum(payouts) <= totalCents and residual >= 0.
 */
export function splitDividendByShares(
  totalCents: number,
  members: Array<{ id: string; shares: number }>,
): Array<{ id: string; shares: number; payoutCents: number }> {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new MoneyError("Total dividend must be a positive integer-cent amount", "INVALID_AMOUNT");
  }
  const eligible = members
    .filter((m) => Number.isInteger(m.shares) && m.shares > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totalShares = eligible.reduce((sum, m) => sum + m.shares, 0);
  if (totalShares <= 0) {
    throw new MoneyError("No active shares available for distribution", "NO_SHARES");
  }

  const base = eligible.map((m) => ({
    ...m,
    exact: (totalCents * m.shares) / totalShares,
    payoutCents: Math.floor((totalCents * m.shares) / totalShares),
  }));

  let distributed = base.reduce((sum, m) => sum + m.payoutCents, 0);
  const residual = totalCents - distributed;
  const order = base
    .map((m, i) => ({ i, frac: m.exact - m.payoutCents }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; k < residual; k++) {
    const target = order[k % order.length];
    if (target !== undefined) {
      const entry = base[target.i];
      if (entry !== undefined) {
        entry.payoutCents += 1;
        distributed += 1;
      }
    }
  }

  return base.map(({ id, shares, payoutCents }) => ({ id, shares, payoutCents }));
}

/** Parse "Month YYYY" / localized month label into ISO date (1st, UTC). */
const MONTH_NAMES_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_NAMES_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Convert Bengali digits (০-৯) to ASCII digits. */
export function normalizeBanglaDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
}

/**
 * Resolve a deposit month label like "January 2024", "Jan 2024",
 * "জানুয়ারি ২০২৪" or "2024-01" to an ISO `yyyy-mm-01` date string.
 * Returns null when unparseable.
 */
export function parseDepositMonthToIso(label: string | null | undefined): string | null {
  if (!label) return null;
  const normalized = normalizeBanglaDigits(label).trim();
  if (!normalized) return null;

  // ISO month "2024-01" / "2024-1"
  const isoMatch = /^(\d{4})-(\d{1,2})$/.exec(normalized);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12 && year >= 1900) {
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
    return null;
  }

  const parts = normalized.split(/\s+/);
  if (parts.length < 2) return null;
  const year = Number(parts[parts.length - 1]);
  if (!Number.isInteger(year) || year < 1900) return null;
  const monthLabel = parts.slice(0, -1).join(" ").toLowerCase().replace(/\.$/, "");

  const byFull = MONTH_NAMES_EN.indexOf(monthLabel);
  if (byFull >= 0) return `${year}-${String(byFull + 1).padStart(2, "0")}-01`;

  const byBn = MONTH_NAMES_BN.findIndex((m) => m === monthLabel);
  if (byBn >= 0) return `${year}-${String(byBn + 1).padStart(2, "0")}-01`;

  const abbr = MONTH_ABBR[monthLabel.slice(0, 3)];
  if (abbr !== undefined && monthLabel.length <= 4) {
    return `${year}-${String(abbr + 1).padStart(2, "0")}-01`;
  }
  return null;
}

/** First millisecond (UTC) of an ISO `yyyy-mm` period key. */
export function monthKeyToUtcStart(monthKey: string): Date | null {
  const iso = parseDepositMonthToIso(monthKey);
  if (!iso) return null;
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Last millisecond (UTC) of an ISO `yyyy-mm` period key. */
export function monthKeyToUtcEnd(monthKey: string): Date | null {
  const start = monthKeyToUtcStart(monthKey);
  if (!start) return null;
  return new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000 - 1);
}

/** Format cents for display, e.g. 123456 -> "1,234.56". */
export function formatCents(cents: number): string {
  return fromCents(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
