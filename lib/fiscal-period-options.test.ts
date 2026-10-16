import { describe, expect, it } from "vitest";
import {
  buildFiscalMonthOptions,
  buildFiscalYearOptions,
  fiscalStartYearOfMonth,
  selectFiscalYears,
  withYearOption,
} from "./fiscal-period-options";

const MONTH_SHORT: Record<string, string> = {
  jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun",
  jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
};

const t = (path: string): string => {
  if (path === "layout.fiscalYearAbbrev") return "FY";
  if (path === "fiscal.status.open") return "Open";
  if (path === "fiscal.status.closed") return "Closed";
  const short = path.split(".").pop() as string;
  return MONTH_SHORT[short] ?? path;
};

const STATUSES = new Map<string, string | null>([
  ["2025", "OPEN"],
  ["2024", "CLOSED"],
  ["2026", null],
]);

describe("buildFiscalYearOptions", () => {
  it("renders the years it is given, oldest first", () => {
    const options = buildFiscalYearOptions([2024, 2025, 2026], "July", "June", t);
    expect(options.map((o) => o.value)).toEqual(["2024", "2025", "2026"]);
    expect(options[1]?.label).toBe("FY 2025-26");
  });

  it("labels a spanning fiscal year as a range and a whole-year one as a single year", () => {
    expect(buildFiscalYearOptions([2025], "July", "June", t)[0]?.label).toBe("FY 2025-26");
    expect(buildFiscalYearOptions([2026], "January", "December", t)[0]?.label).toBe("FY 2026");
  });

  it("marks each year with the status the ledger actually holds", () => {
    const options = buildFiscalYearOptions([2024, 2025, 2026], "July", "June", t, STATUSES);
    expect(options.map((o) => o.label)).toEqual([
      "FY 2024-25 (Closed)",
      "FY 2025-26 (Open)",
      "FY 2026-27",
    ]);
  });
});

describe("withYearOption", () => {
  it("leaves the list untouched when the value is already offered", () => {
    const options = buildFiscalYearOptions([2024, 2025], "July", "June", t, STATUSES);
    expect(withYearOption(options, "2024", "July", "June", t, STATUSES)).toEqual(options);
    expect(withYearOption(options, null, "July", "June", t, STATUSES)).toEqual(options);
  });

  it("adds a missing selected year in order, labelled with its status", () => {
    // Posting lists contain only the open year; editing a deposit that lives in
    // a closed year must still show that year rather than a blank field.
    const options = buildFiscalYearOptions([2025], "July", "June", t, STATUSES);
    const merged = withYearOption(options, "2024", "July", "June", t, STATUSES);
    expect(merged.map((o) => o.value)).toEqual(["2024", "2025"]);
    expect(merged[0]?.label).toBe("FY 2024-25 (Closed)");
  });
});

describe("selectFiscalYears", () => {
  const periods = [
    { year: 2026, status: "DRAFT" },
    { year: 2025, status: "OPEN" },
    { year: 2024, status: "CLOSED" },
  ];

  it("offers only the years open for posting", () => {
    expect(selectFiscalYears({
      periods, pending: false, failed: false,
    })).toEqual([2025]);
  });

  it("offers nothing when no year is open", () => {
    expect(selectFiscalYears({
      periods: [{ year: 2024, status: "CLOSED" }],
      pending: false,
      failed: false,
    })).toEqual([]);
  });

  it("never lists a closed or draft year, even alongside an open one", () => {
    const years = selectFiscalYears({
      periods: [{ year: 2015, status: "CLOSED" }, ...periods],
      pending: false,
      failed: false,
    });
    expect(years).toEqual([2025]);
  });

  it("offers nothing while loading or on failure — never a guessed window", () => {
    const base = { periods };
    expect(selectFiscalYears({ ...base, pending: true, failed: false })).toEqual([]);
    expect(selectFiscalYears({ ...base, pending: false, failed: true })).toEqual([]);
    // An empty tenant has no open year to offer.
    expect(selectFiscalYears({ periods: [], pending: false, failed: false })).toEqual([]);
  });
});

describe("buildFiscalMonthOptions", () => {
  it("runs in fiscal order and values each month with its absolute calendar month", () => {
    const months = buildFiscalMonthOptions(2025, "July", t);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.value)).toEqual([
      "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
    // March of FY 2025-26 is March 2026 — the label carries the year so the
    // user can see which one they are picking.
    expect(months[8]).toEqual({ value: "2026-03", label: "Mar 2026" });
  });

  it("keeps a January-start tenant inside one calendar year", () => {
    const months = buildFiscalMonthOptions(2026, "January", t);
    expect(months[0]).toEqual({ value: "2026-01", label: "Jan 2026" });
    expect(months[11]).toEqual({ value: "2026-12", label: "Dec 2026" });
  });

  it("handles an April-start tenant whose year ends in March", () => {
    const months = buildFiscalMonthOptions(2025, "April", t);
    expect(months[0]?.value).toBe("2025-04");
    expect(months[11]?.value).toBe("2026-03");
  });
});

describe("fiscalStartYearOfMonth", () => {
  it("maps an absolute month back to the fiscal year that contains it", () => {
    expect(fiscalStartYearOfMonth("2025-07", "July")).toBe("2025");
    expect(fiscalStartYearOfMonth("2026-06", "July")).toBe("2025");
    expect(fiscalStartYearOfMonth("2026-03", "July")).toBe("2025");
    expect(fiscalStartYearOfMonth("2025-06", "July")).toBe("2024");
    expect(fiscalStartYearOfMonth("2026-01", "January")).toBe("2026");
  });

  it("round-trips every fiscal month option", () => {
    for (const month of buildFiscalMonthOptions(2025, "July", t)) {
      expect(fiscalStartYearOfMonth(month.value, "July")).toBe("2025");
    }
  });

  it("rejects a malformed month key instead of guessing", () => {
    expect(fiscalStartYearOfMonth("2026-13", "July")).toBeNull();
    expect(fiscalStartYearOfMonth("", "July")).toBeNull();
  });
});
