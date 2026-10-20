"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useFiscalPeriodYears } from "@/lib/fiscal-period-years";
import { fiscalStartYearForDate, isFiscalMonthName } from "@/lib/fiscal-periods";
import { DEFAULT_FISCAL_YEAR_START } from "@/lib/org-setup";
import { useTenantSettings } from "@/lib/use-tenant-settings";

/**
 * App-wide fiscal year (the header selector).
 *
 * The desk works in ONE accounting year at a time. Before this context every
 * screen guessed its own: Analysis and Reports opened on the year open for
 * posting, deposit filters opened empty, forms opened empty — so a user reading
 * 2025-26 history had to re-pick the year on every screen.
 *
 * Now the header owns the selection and it is:
 *   - persisted (localStorage), so navigating between screens keeps it;
 *   - validated against the tenant's real `fiscal_periods` rows, so a year that
 *     another tenant created — or one since deleted — can never stick;
 *   - the default for `useFiscalPeriodOptions().defaultFiscalYear`, i.e. the
 *     year every read screen and every new period form opens on.
 *
 * Value shape: the fiscal START year as a string ("2026" for FY 2026-27), which
 * is exactly the value the period pickers put on the wire.
 */

const STORAGE_KEY = "investwise:fiscal-year";
const YEAR_RE = /^\d{4}$/;

export interface FiscalYearContextValue {
  /** Selected fiscal start year ("2026"), or null until it resolves. */
  fiscalYear: string | null;
  /** Select a year (persisted). Ignores values that are not a 4-digit year. */
  setFiscalYear: (year: string) => void;
  /** Back to the year that is open for posting (or today's fiscal year). */
  reset: () => void;
  /** Every fiscal year the tenant has created, oldest first. */
  years: { year: number; status: string | null }[];
  /** The year the ledger is open for, else the year containing today. */
  currentFiscalYear: string | null;
  /** True when the selection is not the current year (past-year review). */
  isHistorical: boolean;
  /** False while the tenant's year list is still loading. */
  ready: boolean;
}

const FiscalYearContext = createContext<FiscalYearContextValue | null>(null);

function readStoredYear(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && YEAR_RE.test(stored) ? stored : null;
  } catch {
    // Private mode / blocked storage: the session simply does not persist.
    return null;
  }
}

function writeStoredYear(year: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (year === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, year);
  } catch {
    // Non-fatal: the in-memory selection still applies for this session.
  }
}

/**
 * Which year the app should be on, given what the browser stored and what the
 * tenant actually has. Pure and exported so the rule is testable without a
 * renderer — this is the part that must never drift.
 *
 *  - nothing stored            → the fallback (year open for posting, else today)
 *  - list still loading/failed → trust what was stored (no flash of the default)
 *  - stored year exists        → it wins
 *  - stored year is unknown    → fallback (another tenant's year, or deleted)
 */
export function resolveSelectedFiscalYear(args: {
  storedYear: string | null;
  createdYears: string[];
  fallbackYear: string | null;
  pending: boolean;
  failed: boolean;
}): string | null {
  const { storedYear, createdYears, fallbackYear, pending, failed } = args;
  if (!storedYear) return fallbackYear;
  if (pending || failed) return storedYear;
  return createdYears.includes(storedYear) ? storedYear : fallbackYear;
}

export function FiscalYearProvider({ children }: { children: React.ReactNode }) {
  // Read the persisted choice AFTER hydration, not during it: the server has no
  // localStorage, and a value that differs on the client's first render would
  // mismatch every screen that prints the fiscal year. The provider sits above
  // the pages (lib/providers.tsx), so this happens once per session, not once
  // per navigation.
  const [storedYear, setStoredYear] = useState<string | null>(null);
  useEffect(() => {
    const persisted = readStoredYear();
    if (persisted) setStoredYear(persisted);
  }, []);

  // The provider sits above the routes, so it also mounts on /login, /signup and
  // the print views. Both feeds stay disabled until there is a session — an
  // unauthenticated call would 401 and pull the api client's expiry handling
  // into a public page.
  const { user, isLoading: authLoading } = useAuth();
  const enabled = Boolean(user) && !authLoading;

  const { years, openFiscalYear, pending, failed } = useFiscalPeriodYears({ enabled });
  const { data: settings } = useTenantSettings({ enabled });

  const rawStart = settings?.financial?.fiscalYearStart;
  const startMonth = isFiscalMonthName(rawStart) ? rawStart : DEFAULT_FISCAL_YEAR_START;

  const todayFiscalYear = useMemo(() => {
    try {
      return String(fiscalStartYearForDate(new Date(), startMonth));
    } catch {
      return null;
    }
  }, [startMonth]);

  // The year a screen should show when the user has not chosen one: the year
  // open for posting, else the year today falls in.
  const currentFiscalYear = openFiscalYear ?? todayFiscalYear;

  const createdYears = useMemo(() => years.map((period) => String(period.year)), [years]);

  const fiscalYear = useMemo(
    () =>
      resolveSelectedFiscalYear({
        storedYear,
        createdYears,
        fallbackYear: currentFiscalYear,
        pending,
        failed,
      }),
    [createdYears, currentFiscalYear, failed, pending, storedYear],
  );

  const setFiscalYear = useCallback((year: string) => {
    if (!YEAR_RE.test(year)) return;
    setStoredYear(year);
    writeStoredYear(year);
  }, []);

  const reset = useCallback(() => {
    setStoredYear(null);
    writeStoredYear(null);
  }, []);

  // A stored year that no longer exists is already ignored by the derived
  // value above; persist the fallback so the next load starts on a real year
  // instead of re-deriving it. Deliberately no state update — the render
  // already shows the right year, so re-rendering here would be a cascade for
  // nothing.
  useEffect(() => {
    if (pending || failed || !storedYear) return;
    if (createdYears.length === 0) return;
    if (createdYears.includes(storedYear)) return;
    writeStoredYear(currentFiscalYear);
  }, [createdYears, currentFiscalYear, failed, pending, storedYear]);

  const value = useMemo<FiscalYearContextValue>(
    () => ({
      fiscalYear,
      setFiscalYear,
      reset,
      years,
      currentFiscalYear,
      isHistorical: !!fiscalYear && !!currentFiscalYear && fiscalYear !== currentFiscalYear,
      ready: !pending,
    }),
    [currentFiscalYear, fiscalYear, pending, reset, setFiscalYear, years],
  );

  return <FiscalYearContext.Provider value={value}>{children}</FiscalYearContext.Provider>;
}

/**
 * The header's fiscal year. Safe outside the provider (auth pages, print
 * routes): falls back to a no-op selection so a stray consumer cannot crash a
 * screen that has no shell around it.
 */
export function useFiscalYear(): FiscalYearContextValue {
  const context = useContext(FiscalYearContext);
  if (context) return context;
  return {
    fiscalYear: null,
    setFiscalYear: () => {},
    reset: () => {},
    years: [],
    currentFiscalYear: null,
    isHistorical: false,
    ready: false,
  };
}

/**
 * Re-run `sync` whenever the header year changes (including on mount), so a
 * screen-level year filter cannot keep pointing at the previous year.
 *
 * `sync` must be stable (a state setter or a useCallback): the effect keys on
 * it, and an inline arrow would re-fire on every render.
 */
export function useFiscalYearSync(sync: (year: string | null) => void): void {
  const { fiscalYear } = useFiscalYear();
  useEffect(() => {
    sync(fiscalYear);
  }, [fiscalYear, sync]);
}
