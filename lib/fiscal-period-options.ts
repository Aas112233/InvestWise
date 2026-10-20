"use client";

import { useCallback, useMemo } from "react";
import { useLocale } from "@/lib/i18n";
import { DEFAULT_FISCAL_YEAR_END, DEFAULT_FISCAL_YEAR_START } from "@/lib/org-setup";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { useFiscalYear } from "@/lib/fiscal-year-context";
import { useFiscalPeriodYears, type FiscalPeriodYear } from "@/lib/fiscal-period-years";
import {
  fiscalMonthKeys,
  fiscalMonthSequence,
  fiscalStartYearForDate,
  resolveFiscalBounds,
} from "@/lib/fiscal-periods";

/**
 * Period pickers (Rule §8): every module that asks for an accounting period
 * builds its dropdowns from the tenant's fiscal calendar AND from the fiscal
 * years that actually exist as `fiscal_periods` rows.
 *
 * Values stay on the wire contract the server already validates:
 *   fiscal year option  → the calendar year the FY starts in ("2025")
 *   fiscal month option → an absolute calendar month key ("2026-03")
 * so a July-start tenant's "March" resolves to 2026-03, not 2025-03, and no
 * stored `depositMonth`, report `fiscalMonth` or `lastDepositMonth` ordering
 * changes.
 *
 * POSTING pickers (deposit forms, bulk modals) offer only the fiscal years
 * whose `fiscal_periods` row is OPEN. A CLOSED year is never selectable there,
 * and neither is a calendar year that was never created: posting rejects both
 * (`assertFiscalPeriodOpen`, lib/fiscal-guard.ts).
 *
 * READ screens (Analysis, Reports) need the opposite rule: closed years hold
 * the history they exist to report on, so they use `yearOptionsAllIncluding`
 * — every created year, labelled (Open)/(Closed).
 *
 * While the period list is loading or failed a picker is simply empty — never
 * a guessed calendar window — so a year that does not actually exist can
 * never appear.
 */

export interface FiscalPeriodOption {
  value: string;
  label: string;
}

type Translate = (
  path: string,
  vars?: Record<string, string | number> & { defaultValue?: string },
) => string;

/**
 * Fiscal year options, oldest first: value = FY start year,
 * label = "FY 2025-26 (Closed)" when `statusByYear` knows that year's state.
 */
export function buildFiscalYearOptions(
  years: number[],
  startMonth: string,
  endMonth: string,
  t: Translate,
  statusByYear: ReadonlyMap<string, string | null> | null = null,
): FiscalPeriodOption[] {
  const abbrev = t("layout.fiscalYearAbbrev", { defaultValue: "FY" });
  return years.map((year) => {
    let label = String(year);
    try {
      label = resolveFiscalBounds(year, startMonth, endMonth).label;
    } catch {
      // A legacy row may hold a malformed month name; the settings screen
      // rejects it on write, and the picker still needs to render.
    }
    const text = `${abbrev} ${label}`;
    const status = statusByYear?.get(String(year)) ?? null;
    const stateKey =
      status === "OPEN" ? "fiscal.status.open" : status === "CLOSED" ? "fiscal.status.closed" : null;
    return { value: String(year), label: stateKey ? `${text} (${t(stateKey)})` : text };
  });
}

/**
 * Which fiscal years a picker may offer: only the years whose `fiscal_periods`
 * row is OPEN. A CLOSED year is never selectable, and neither is a calendar
 * year that was never created, because posting rejects both
 * (`assertFiscalPeriodOpen`) and reporting must not offer a year the desk
 * cannot act on.
 *
 * While the period list is loading or failed the list is empty — we never guess
 * a calendar window, so a year that is not open can never appear.
 */
export function selectFiscalYears(params: {
  periods: FiscalPeriodYear[];
  pending: boolean;
  failed: boolean;
}): number[] {
  if (params.pending || params.failed) return [];
  return params.periods
    .filter((period) => period.status === "OPEN")
    .map((period) => period.year)
    .sort((a, b) => a - b);
}

/**
 * Every created fiscal year (any status), oldest first — for READ screens
 * (Analysis, Reports), where closed history must stay selectable. A year the
 * desk has closed is precisely the year a report most wants to cover.
 */
export function selectAllFiscalYears(params: {
  periods: FiscalPeriodYear[];
  pending: boolean;
  failed: boolean;
}): number[] {
  if (params.pending || params.failed) return [];
  return params.periods.map((period) => period.year).sort((a, b) => a - b);
}

/**
 * `options` plus an entry for `selected` when the list does not contain it, so
 * a field never renders blank on a value the user (or a stored row) already
 * holds. The added entry carries that year's real status label.
 */
export function withYearOption(
  options: FiscalPeriodOption[],
  selected: string | null,
  startMonth: string,
  endMonth: string,
  t: Translate,
  statusByYear: ReadonlyMap<string, string | null> | null = null,
): FiscalPeriodOption[] {
  if (!selected || options.some((option) => option.value === selected)) return options;
  const extra = buildFiscalYearOptions([Number(selected)], startMonth, endMonth, t, statusByYear);
  return [...options, ...extra].sort((a, b) => Number(a.value) - Number(b.value));
}

/**
 * The twelve months of one fiscal year, in fiscal order (start month first),
 * each valued with its absolute calendar month.
 *
 * The month KEYS come from `fiscalMonthKeys` — the same expansion the server
 * uses for the per-member deposit month grid — so the picker and the grid can
 * never label or order the same fiscal year differently.
 */
export function buildFiscalMonthOptions(
  fiscalStartYear: number,
  startMonth: string,
  t: Translate,
): FiscalPeriodOption[] {
  const sequence = fiscalMonthSequence(startMonth);
  return fiscalMonthKeys(fiscalStartYear, startMonth).map((value, offset) => ({
    value,
    label: `${t(`common.months.${sequence[offset]!.shortKey}`)} ${value.slice(0, 4)}`,
  }));
}

/** The fiscal start year an absolute "YYYY-MM" month key belongs to. */
export function fiscalStartYearOfMonth(monthKey: string, startMonth: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  return String(fiscalStartYearForDate(new Date(Date.UTC(year, monthNumber - 1, 1)), startMonth));
}

/**
 * The tenant's fiscal years and their posting status, newest first from the
 * API. Re-exported from lib/fiscal-period-years so the ~10 call sites that
 * have always imported it here keep working, while the header's global
 * fiscal-year context can read the same feed without a circular import.
 */
export { useFiscalPeriodYears, type FiscalPeriodYear } from "@/lib/fiscal-period-years";

function useFiscalStartMonths(): { startMonth: string; endMonth: string } {
  const { data } = useTenantSettings();
  return {
    startMonth: data?.financial?.fiscalYearStart || DEFAULT_FISCAL_YEAR_START,
    endMonth: data?.financial?.fiscalYearEnd || DEFAULT_FISCAL_YEAR_END,
  };
}

/**
 * Tenant-fiscal year + month options for period pickers. Reads the tenant's
 * configured fiscal calendar and its real period rows, so the deposit desk, the
 * request screens, Reports and Analysis agree on ranges, labels and what can
 * legally be posted.
 */
export function useFiscalPeriodOptions() {
  const { t } = useLocale();
  const { startMonth, endMonth } = useFiscalStartMonths();
  const currentFiscalYear = String(fiscalStartYearForDate(new Date(), startMonth));
  const { years, openFiscalYear, pending, failed } = useFiscalPeriodYears();

  const statusByYear = useMemo(
    () => new Map(years.map((period) => [String(period.year), period.status])),
    [years],
  );

  const listableYears = useMemo(
    () =>
      selectFiscalYears({
        periods: years,
        pending,
        failed,
      }),
    [failed, pending, years],
  );

  const yearOptions = useMemo(
    () => buildFiscalYearOptions(listableYears, startMonth, endMonth, t, statusByYear),
    [listableYears, startMonth, endMonth, t, statusByYear],
  );

  /**
   * Read-screen year options: EVERY created fiscal year, labelled (Open)/
   * (Closed). Posting pickers must keep using `yearOptions` (OPEN only) —
   * offering a closed year to a deposit form would let the desk select a
   * period the write path immediately rejects.
   */
  const allListableYears = useMemo(
    () =>
      selectAllFiscalYears({
        periods: years,
        pending,
        failed,
      }),
    [failed, pending, years],
  );

  const yearOptionsAll = useMemo(
    () => buildFiscalYearOptions(allListableYears, startMonth, endMonth, t, statusByYear),
    [allListableYears, startMonth, endMonth, t, statusByYear],
  );

  /**
   * `yearOptions` plus `selected` when the list does not contain it. Editing a
   * row that lives in a closed or never-created period must still show that
   * period instead of a blank field; the entry is labelled with its real
   * status, and the write stays blocked server-side (the finance service
   * re-checks the existing row's date before touching a balance).
   */
  const yearOptionsIncluding = useCallback(
    (selected: string | null): FiscalPeriodOption[] =>
      withYearOption(yearOptions, selected, startMonth, endMonth, t, statusByYear),
    [endMonth, startMonth, statusByYear, t, yearOptions],
  );

  /** Read-screen variant: all created years (Open and Closed) + `selected`. */
  const yearOptionsAllIncluding = useCallback(
    (selected: string | null): FiscalPeriodOption[] =>
      withYearOption(yearOptionsAll, selected, startMonth, endMonth, t, statusByYear),
    [endMonth, startMonth, statusByYear, t, yearOptionsAll],
  );

  const monthsFor = useCallback(
    (fiscalYear: string | null): FiscalPeriodOption[] =>
      fiscalYear === null ? [] : buildFiscalMonthOptions(Number(fiscalYear), startMonth, t),
    [startMonth, t],
  );

  const fiscalStartYearOf = useCallback(
    (monthKey: string) => fiscalStartYearOfMonth(monthKey, startMonth),
    [startMonth],
  );

  /**
   * The period a read screen (Reports, Analysis) opens on: the year chosen in
   * the HEADER's fiscal-year selector, falling back to the year actually open
   * for posting — and within it the current month, or that year's first fiscal
   * month when it doesn't contain today (a year started early or late).
   *
   * The header is the app-wide default on purpose: the desk sets "the year I am
   * working in" once, and every screen that would otherwise guess follows it.
   */
  const { fiscalYear: headerFiscalYear } = useFiscalYear();
  const defaultFiscalYear = headerFiscalYear ?? openFiscalYear ?? currentFiscalYear;

  /**
   * The header year, but only when the ledger is still open for posting.
   *
   * POSTING forms seed their period from this, not from `defaultFiscalYear`:
   * offering a closed year would present a period the write immediately rejects
   * (`assertFiscalPeriodOpen`). A read screen keeps using `defaultFiscalYear`,
   * because closed history is exactly what it reports on.
   */
  const defaultPostableFiscalYear = useMemo(
    () => (yearOptions.some((option) => option.value === defaultFiscalYear) ? defaultFiscalYear : null),
    [defaultFiscalYear, yearOptions],
  );
  const defaultMonthKey = useCallback(
    (fiscalYear: string) =>
      fiscalYear === currentFiscalYear
        // Matches the server's own deposit-month fallback (UTC YYYY-MM).
        ? new Date().toISOString().slice(0, 7)
        : buildFiscalMonthOptions(Number(fiscalYear), startMonth, t)[0]!.value,
    [currentFiscalYear, startMonth, t],
  );

  return {
    startMonth,
    endMonth,
    currentFiscalYear,
    openFiscalYear,
    /** Header selection (null until the tenant's years resolve). */
    selectedFiscalYear: headerFiscalYear,
    defaultFiscalYear,
    /** Header year when it is still open for posting — the form seed. */
    defaultPostableFiscalYear,
    defaultMonthKey,
    yearOptions,
    yearOptionsIncluding,
    yearOptionsAll,
    yearOptionsAllIncluding,
    monthsFor,
    fiscalStartYearOf,
  };
}
