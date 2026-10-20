const MONTHS = [
  { index: 0, name: "January", key: "january", shortKey: "jan", shortLabel: "Jan" },
  { index: 1, name: "February", key: "february", shortKey: "feb", shortLabel: "Feb" },
  { index: 2, name: "March", key: "march", shortKey: "mar", shortLabel: "Mar" },
  { index: 3, name: "April", key: "april", shortKey: "apr", shortLabel: "Apr" },
  { index: 4, name: "May", key: "may", shortKey: "may", shortLabel: "May" },
  { index: 5, name: "June", key: "june", shortKey: "jun", shortLabel: "Jun" },
  { index: 6, name: "July", key: "july", shortKey: "jul", shortLabel: "Jul" },
  { index: 7, name: "August", key: "august", shortKey: "aug", shortLabel: "Aug" },
  { index: 8, name: "September", key: "september", shortKey: "sep", shortLabel: "Sep" },
  { index: 9, name: "October", key: "october", shortKey: "oct", shortLabel: "Oct" },
  { index: 10, name: "November", key: "november", shortKey: "nov", shortLabel: "Nov" },
  { index: 11, name: "December", key: "december", shortKey: "dec", shortLabel: "Dec" },
] as const;

const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS.map(({ name, index }) => [name, index]),
);

export interface FiscalBounds {
  year: number;
  periodStart: Date;
  periodEnd: Date;
  label: string;
}

function monthIndex(month: string, field: string): number {
  const index = MONTH_INDEX[month];
  if (index === undefined) throw new Error(`${field} must be a full English month name`);
  return index;
}

export type FiscalMonth = (typeof MONTHS)[number];

/** Calendar months in fiscal-period order, starting with the configured month. */
export function fiscalMonthSequence(startMonth: string): FiscalMonth[] {
  const startIndex = monthIndex(startMonth, "Fiscal year start");
  return Array.from({ length: 12 }, (_, offset) => MONTHS[(startIndex + offset) % 12]!);
}

/**
 * The twelve absolute `YYYY-MM` keys of one fiscal year, in fiscal order
 * (the configured start month first) — the wire form every period field takes.
 *
 * This is the ONE place the fiscal calendar is expanded into month keys: the
 * client pickers (`buildFiscalMonthOptions`), the server's per-member deposit
 * month grid and the write path's duplicate-month rule all derive their months
 * from it, so a month the desk can see can never disagree with a month the
 * server will accept.
 */
export function fiscalMonthKeys(fiscalStartYear: number, startMonth: string): string[] {
  if (!Number.isInteger(fiscalStartYear) || fiscalStartYear < 1900 || fiscalStartYear > 9998) {
    throw new Error('Fiscal start year must be an integer from 1900 to 9998');
  }
  const startIndex = monthIndex(startMonth, 'Fiscal year start');
  return Array.from({ length: 12 }, (_, offset) => {
    const absolute = startIndex + offset;
    const year = fiscalStartYear + Math.floor(absolute / 12);
    const monthNumber = (absolute % 12) + 1;
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
  });
}

/** The full English month names, in calendar order — for validating stored values. */
export const FISCAL_MONTH_NAMES: readonly string[] = MONTHS.map((m) => m.name);

/** True when the value is a full English month name the fiscal helpers accept. */
export function isFiscalMonthName(value: unknown): value is string {
  return typeof value === "string" && (FISCAL_MONTH_NAMES as readonly string[]).includes(value);
}

/**
 * The end month of a 12-month fiscal year that starts at `startMonth`
 * (the month before the start, wrapping the calendar). Reading screens and
 * the settings guard both need "what end month does this start month imply"
 * to spot rows where a legacy/misconfigured end month would silently shorten
 * or re-bucket the fiscal year.
 */
export function fiscalYearEndForStart(startMonth: string): string {
  const startIndex = monthIndex(startMonth, "Fiscal year start");
  return MONTHS[(startIndex + 11) % 12]!.name;
}

/** Zero-based position of a date's month within its fiscal year, using UTC. */
export function fiscalMonthOffsetForDate(date: Date, startMonth: string): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("Date must be valid");
  const startIndex = monthIndex(startMonth, "Fiscal year start");
  return (date.getUTCMonth() - startIndex + 12) % 12;
}

/** Whether the month belongs in the regularity denominator; the current month is included as before. */
export function isFiscalMonthEvaluated(
  fiscalStartYear: number,
  monthOffset: number,
  now: Date,
  startMonth: string,
): boolean {
  if (!Number.isInteger(fiscalStartYear) || fiscalStartYear < 1900 || fiscalStartYear > 9998) {
    throw new Error("Fiscal start year must be an integer from 1900 to 9998");
  }
  if (!Number.isInteger(monthOffset) || monthOffset < 0 || monthOffset > 11) {
    throw new Error("Fiscal month offset must be an integer from 0 to 11");
  }
  const currentFiscalYear = fiscalStartYearForDate(now, startMonth);
  if (fiscalStartYear < currentFiscalYear) return true;
  if (fiscalStartYear > currentFiscalYear) return false;
  return monthOffset <= fiscalMonthOffsetForDate(now, startMonth);
}

/**
 * Derive an annual period from the tenant's configured start and end months.
 * `year` is the calendar year in which the fiscal period starts. UTC bounds
 * avoid server-local timezone differences; end is inclusive to match the
 * existing fiscal_periods contract.
 */
export function resolveFiscalBounds(
  year: number,
  startMonth: string,
  endMonth: string,
): FiscalBounds {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) {
    throw new Error('Fiscal start year must be an integer from 1900 to 9998');
  }
  const startIndex = monthIndex(startMonth, 'Fiscal year start');
  const endIndex = monthIndex(endMonth, 'Fiscal year end');
  if (startIndex === endIndex) throw new Error('Fiscal year start and end months must differ');

  const endYear = endIndex < startIndex ? year + 1 : year;
  const periodStart = new Date(Date.UTC(year, startIndex, 1));
  const periodEnd = new Date(Date.UTC(endYear, endIndex + 1, 1) - 1);
  const label = endYear === year ? String(year) : `${year}-${String(endYear % 100).padStart(2, '0')}`;
  return { year, periodStart, periodEnd, label };
}

/** The fiscal start year containing the supplied UTC date. */
export function fiscalStartYearForDate(date: Date, startMonth: string): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Date must be valid');
  const startIndex = monthIndex(startMonth, 'Fiscal year start');
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= startIndex ? year : year - 1;
}

/** Resolve a month selected as YYYY-MM to inclusive UTC month boundaries. */
export function resolveCalendarMonthBounds(month: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Month must use YYYY-MM format');
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1900 || year > 9998 || monthNumber < 1 || monthNumber > 12) {
    throw new Error('Month is outside the supported range');
  }
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1) - 1),
  };
}

/** Resolve a quarter relative to the tenant fiscal start month. */
export function resolveFiscalQuarterBounds(
  year: number,
  quarter: string,
  startMonth: string,
): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 1900 || year > 9998) throw new Error('Fiscal year is invalid');
  const match = /^Q([1-4])$/.exec(quarter);
  if (!match) throw new Error('Fiscal quarter must be Q1, Q2, Q3, or Q4');
  const fiscalStartMonth = monthIndex(startMonth, 'Fiscal year start');
  const monthOffset = (Number(match[1]) - 1) * 3;
  const startMonthAbsolute = fiscalStartMonth + monthOffset;
  const startYear = year + Math.floor(startMonthAbsolute / 12);
  const startMonthIndex = startMonthAbsolute % 12;
  return {
    start: new Date(Date.UTC(startYear, startMonthIndex, 1)),
    end: new Date(Date.UTC(startYear, startMonthIndex + 3, 1) - 1),
  };
}

/** Pick the next uncreated fiscal start year, never earlier than the current FY. */
export function nextFiscalStartYear(
  now: Date,
  startMonth: string,
  existingYears: number[],
): number {
  const currentYear = fiscalStartYearForDate(now, startMonth);
  const latestYear = existingYears.reduce((latest, year) => Math.max(latest, year), currentYear - 1);
  return Math.max(currentYear, latestYear + 1);
}
