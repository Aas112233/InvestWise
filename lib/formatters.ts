/**
 * Universal date, time, and money formatting helpers adhering to InvestWise ERP standards.
 * Complies with AGENTS.md §8:
 * - Dates: tenant format DD/MM/YYYY for display, ISO wire format.
 * - Money: decimal(15,2) 2dp string boundary, zero float artifacts.
 */

/**
 * UI locale -> Intl tag for number/currency formatting.
 * All locales are pinned to Western digits (nu-latn) — the app's previous
 * behavior was en-US everywhere, and BD users expect ৳ + Western numerals,
 * not Bengali numerals (০১২৩).
 */
export const intlLocaleFor = (uiLocale: string): string => {
  switch (uiLocale) {
    case "bn":
      return "bn-BD-u-nu-latn";
    case "hi":
      return "hi-IN-u-nu-latn";
    case "ur":
      return "ur-u-nu-latn";
    default:
      return "en-US";
  }
};

/**
 * `currencyCode` is deliberately required: a default let call sites silently
 * stamp a tenant's money with "BDT". Callers in components use
 * useFormatMoney() (tenant currency); server code passes the tenant setting.
 */
export const formatMoney = (
  amount: number | string | null | undefined,
  currencyCode: string,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number; locale?: string }
): string => {
  if (amount === null || amount === undefined || amount === "") return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "-";

  const minDigits = options?.minimumFractionDigits ?? 2;
  const maxDigits = options?.maximumFractionDigits ?? 2;
  const locale = options?.locale ?? "en-US";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode || "BDT",
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    }).format(num);
  } catch {
    return `${currencyCode || "BDT"} ${num.toLocaleString(locale, {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    })}`;
  }
};

export const formatCompactNumber = (number: number | string | null | undefined): string => {
  if (number === null || number === undefined || number === "") return "0";
  const num = typeof number === "string" ? parseFloat(number) : number;
  if (isNaN(num)) return "0";
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
};

export const formatDate = (
  date: string | Date | null | undefined,
  includeTime: boolean = false
): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  if (!includeTime) {
    return `${day}/${month}/${year}`;
  }

  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};


/**
 * 'YYYY-MM-DD' for a Date in the VIEWER'S LOCAL timezone.
 *
 * Use this — never `toISOString().split('T')[0]` — for anything that means
 * "the calendar day the user is looking at": today's date defaults, date-input
 * values, and date-only comparisons. `toISOString()` converts to UTC first, so
 * east of Greenwich every local evening produced YESTERDAY (and the header and
 * the date inputs disagreed about "Today" — report issue 18).
 */
export const toLocalIsoDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** "Today" in the viewer's local timezone as 'YYYY-MM-DD'. */
export const todayLocalIso = (): string => toLocalIsoDate(new Date());

// Manual token formatting against a tenant dateFormat pattern
// (default DD/MM/YYYY). Never toLocaleDateString (Rule §8).
export const formatDatePattern = (
  date: string | Date | null | undefined,
  pattern: string = "DD/MM/YYYY",
  includeTime: boolean = false,
): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  let out = pattern.replace("DD", day).replace("MM", month).replace("YYYY", year);
  if (includeTime) {
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    out += ` ${hours}:${minutes}`;
  }
  return out;
};

/**
 * Format a DATE-ONLY value (a calendar day: ledger posting dates, project
 * start/completion dates, goal deadlines) against a tenant pattern, in UTC.
 *
 * The server anchors these days at UTC midnight (it parses `YYYY-MM-DD` with
 * `new Date()`). Reading them back with the LOCAL components (formatDate)
 * drops a day for every viewer west of UTC, so a posting made "on the 2nd"
 * rendered as the 1st. Date-only values are therefore formatted in UTC — the
 * same convention the server-side reports use (formatUtcDate). Timestamps
 * that carry a real time-of-day (createdAt, lastLogin) still use formatDate.
 */
export const formatDateOnly = (
  value: string | Date | null | undefined,
  pattern: string = "DD/MM/YYYY",
): string => {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = String(d.getUTCFullYear());
  return pattern.replace("DD", day).replace("MM", month).replace("YYYY", year);
};

/**
 * Inclusive end-of-day (UTC) for a date-only "YYYY-MM-DD" range end.
 *
 * A date-only end must cover the WHOLE day: `new Date("2026-03-31")` is UTC
 * midnight, so `lte(date, that)` silently drops every row collected after
 * 00:00 on the 31st — the "Collected this month" badge understated by the
 * last day's collections every month. Full ISO timestamps pass through
 * unchanged (the caller already chose an exact instant). Mirrors the
 * convention reports/catalog.ts uses for custom ranges.
 */
export const endOfRangeUtc = (value: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return new Date(value);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999));
};
