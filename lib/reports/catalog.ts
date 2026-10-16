/**
 * Report catalog + period resolution — shared by the reports UI and the
 * /api/reports/generate/[type] route. Client-safe: no db/server imports.
 *
 * Canonical slugs replace the old substring matching on English display
 * names ("...includes('ledger')"), which silently misrouted half the
 * report types to a placeholder row.
 */

export type ReportLocale = "en" | "ur" | "hi" | "bn";

export type ReportCategory = "ledger" | "deposits" | "incomes" | "expenses" | "projects";

/**
 * Wire format of /api/reports/generate. `xlsx` is a real Excel workbook.
 * `json` returns the SAME assembled document (header + columns + rows +
 * summary) so the in-app viewer at /reports/[slug] renders exactly what the
 * file exports contain — no second query path (issue #32).
 */
export type ReportFormat = "xlsx" | "pdf" | "csv" | "json";

export type ReportEntity = "project" | "member" | "fund";

export type ReportPeriodType = "Monthly" | "Quarterly" | "Yearly" | "Custom";

export interface ReportColumn {
  key: string;
  /** i18n path under `reports.columns`. */
  labelKey: string;
  type: "money" | "date" | "number" | "text";
  /** Money column that receives a totals row in Excel/PDF. */
  total?: boolean;
}

export interface ReportDefinition {
  slug: string;
  category: ReportCategory;
  /** i18n path under `reports.types`. */
  nameKey: string;
  /** i18n path under `reports.descs`. */
  descKey: string;
  /** Entity selector that must be chosen before this report can run. */
  requires?: ReportEntity;
  /** Entity that refines the report but may stay unselected (whole-book view). */
  optionalEntity?: ReportEntity;
  /** Current-state snapshot — period filter does not apply (renders "As of"). */
  pointInTime?: boolean;
}

export const REPORT_TYPES: ReportDefinition[] = [
  // ── Ledger ────────────────────────────────────────────────────────
  {
    slug: "comprehensive-ledger",
    category: "ledger",
    nameKey: "reports.types.comprehensiveLedger",
    descKey: "reports.descs.comprehensiveLedger",
  },
  {
    slug: "project-ledger",
    category: "ledger",
    nameKey: "reports.types.projectLedger",
    descKey: "reports.descs.projectLedger",
    requires: "project",
  },
  {
    slug: "member-ledger",
    category: "ledger",
    nameKey: "reports.types.memberLedger",
    descKey: "reports.descs.memberLedger",
    requires: "member",
  },
  {
    slug: "fund-ledger",
    category: "ledger",
    nameKey: "reports.types.fundLedger",
    descKey: "reports.descs.fundLedger",
    requires: "fund",
  },
  {
    slug: "funds-summary",
    category: "ledger",
    nameKey: "reports.types.fundsSummary",
    descKey: "reports.descs.fundsSummary",
    pointInTime: true,
  },
  // ── Deposits ──────────────────────────────────────────────────────
  {
    slug: "member-history",
    category: "deposits",
    nameKey: "reports.types.memberHistory",
    descKey: "reports.descs.memberHistory",
    requires: "member",
  },
  {
    slug: "member-contribution",
    category: "deposits",
    nameKey: "reports.types.memberContribution",
    descKey: "reports.descs.memberContribution",
    optionalEntity: "member",
  },
  {
    slug: "stakeholder-statement",
    category: "deposits",
    nameKey: "reports.types.stakeholderStatement",
    descKey: "reports.descs.stakeholderStatement",
    optionalEntity: "member",
    pointInTime: true,
  },
  {
    slug: "penalties-audit",
    category: "deposits",
    nameKey: "reports.types.penaltiesAudit",
    descKey: "reports.descs.penaltiesAudit",
    optionalEntity: "member",
  },
  // ── Income ────────────────────────────────────────────────────────
  {
    slug: "revenue-analytics",
    category: "incomes",
    nameKey: "reports.types.revenueAnalytics",
    descKey: "reports.descs.revenueAnalytics",
  },
  {
    slug: "earnings-ledger",
    category: "incomes",
    nameKey: "reports.types.earningsLedger",
    descKey: "reports.descs.earningsLedger",
  },
  {
    slug: "interest-accruals",
    category: "incomes",
    nameKey: "reports.types.interestAccruals",
    descKey: "reports.descs.interestAccruals",
  },
  {
    slug: "dividend-report",
    category: "incomes",
    nameKey: "reports.types.dividendReport",
    descKey: "reports.descs.dividendReport",
  },
  // ── Expenses ──────────────────────────────────────────────────────
  {
    slug: "expense-audit",
    category: "expenses",
    nameKey: "reports.types.expenseAudit",
    descKey: "reports.descs.expenseAudit",
  },
  {
    slug: "project-expense-audit",
    category: "expenses",
    nameKey: "reports.types.projectExpenseAudit",
    descKey: "reports.descs.projectExpenseAudit",
    requires: "project",
  },
  // ── Projects ──────────────────────────────────────────────────────
  {
    slug: "project-performance",
    category: "projects",
    nameKey: "reports.types.projectPerformance",
    descKey: "reports.descs.projectPerformance",
    pointInTime: true,
  },
  {
    slug: "roi-analysis",
    category: "projects",
    nameKey: "reports.types.roiAnalysis",
    descKey: "reports.descs.roiAnalysis",
    pointInTime: true,
  },
  {
    slug: "venture-growth",
    category: "projects",
    nameKey: "reports.types.ventureGrowth",
    descKey: "reports.descs.ventureGrowth",
    pointInTime: true,
  },
  {
    slug: "disbursements",
    category: "projects",
    nameKey: "reports.types.disbursements",
    descKey: "reports.descs.disbursements",
    optionalEntity: "project",
  },
];

const REPORT_INDEX = new Map(REPORT_TYPES.map((r) => [r.slug, r]));

export function getReportDefinition(slug: string): ReportDefinition | undefined {
  return REPORT_INDEX.get(slug);
}

export const REPORT_CATEGORIES: Array<{ id: ReportCategory; nameKey: string }> = [
  { id: "ledger", nameKey: "reports.categories.ledger" },
  { id: "deposits", nameKey: "reports.categories.deposits" },
  { id: "incomes", nameKey: "reports.categories.incomes" },
  { id: "expenses", nameKey: "reports.categories.expenses" },
  { id: "projects", nameKey: "reports.categories.projects" },
];

export function reportsForCategory(category: ReportCategory): ReportDefinition[] {
  return REPORT_TYPES.filter((r) => r.category === category);
}

import {
  resolveCalendarMonthBounds,
  resolveFiscalBounds,
  resolveFiscalQuarterBounds,
} from "@/lib/fiscal-periods";

/** Tenant fiscal calendar (systemSettings, English month names, e.g. "July"). */
export interface FiscalCalendar {
  startMonth: string;
  endMonth: string;
}

export const DEFAULT_FISCAL: FiscalCalendar = { startMonth: "July", endMonth: "June" };

// ─────────────────────────────────────────────────────────────────────
// Period resolution (Rule §8: fiscal selectors, ISO on the wire)
// ─────────────────────────────────────────────────────────────────────

export interface ReportPeriodParams {
  periodType?: ReportPeriodType | string;
  /** `YYYY-MM`. */
  fiscalMonth?: string | null;
  /** `Q1`..`Q4`. */
  fiscalQuarter?: string | null;
  /** `YYYY`. */
  fiscalYear?: string | null;
  /** ISO `yyyy-mm-dd`. */
  startDate?: string | null;
  /** ISO `yyyy-mm-dd`, inclusive. */
  endDate?: string | null;
}

export interface ResolvedPeriod {
  /** Inclusive lower bound, UTC midnight. */
  start: Date;
  /** Inclusive upper bound, UTC end of day. */
  end: Date;
}

/** Field name + i18n message code for §11 error formatting in the route. */
export class ReportParamError extends Error {
  field: string;
  code: string;
  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = "ReportParamError";
    this.field = field;
    this.code = code;
  }
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseMonth(param: string | null | undefined, field: string): { y: number; m: number } {
  if (!param) throw new ReportParamError(field, "REQUIRED", `${field} is required for this period`);
  const match = MONTH_RE.exec(param);
  if (!match) throw new ReportParamError(field, "INVALID_FORMAT", `${field} must be YYYY-MM`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new ReportParamError(field, "INVALID_MONTH", `${field} month must be 01-12`);
  return { y, m };
}

function parseYear(param: string | null | undefined, field: string): number {
  if (!param) throw new ReportParamError(field, "REQUIRED", `${field} is required for this period`);
  if (!YEAR_RE.test(param)) throw new ReportParamError(field, "INVALID_FORMAT", `${field} must be YYYY`);
  return Number(param);
}

function parseIsoDate(param: string | null | undefined, field: string): Date {
  if (!param) throw new ReportParamError(field, "REQUIRED", `${field} is required for this period`);
  const match = ISO_DATE_RE.exec(param);
  if (!match) throw new ReportParamError(field, "INVALID_FORMAT", `${field} must be an ISO date (yyyy-mm-dd)`);
  const year = Number(match[1]);
  const date = new Date(`${param}T00:00:00.000Z`);
  if (
    year < 1900 ||
    year > 9998 ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== param
  ) {
    throw new ReportParamError(field, "INVALID_DATE", `${field} is not a valid calendar date`);
  }
  return date;
}

/**
 * Resolve the fiscal selector set into a concrete UTC [start, end] range.
 * Quarterly/Yearly ranges follow the tenant's fiscal calendar (start month
 * from systemSettings) via lib/fiscal-periods. Defaults to the current month
 * when periodType is absent or unrecognized — reports must never silently
 * return all-time data.
 */
export function resolveReportPeriod(
  params: ReportPeriodParams,
  fiscal: FiscalCalendar = DEFAULT_FISCAL,
): ResolvedPeriod {
  const periodType = params.periodType || "Monthly";
  if (!["Monthly", "Quarterly", "Yearly", "Custom"].includes(periodType)) {
    throw new ReportParamError("periodType", "INVALID_VALUE", "periodType must be Monthly, Quarterly, Yearly, or Custom");
  }

  if (periodType === "Monthly") {
    const now = new Date();
    const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const { y, m } = parseMonth(params.fiscalMonth || fallback, "fiscalMonth");
    const bounds = resolveCalendarMonthBounds(`${y}-${String(m).padStart(2, "0")}`);
    return { start: bounds.start, end: bounds.end };
  }

  if (periodType === "Quarterly") {
    const y = parseYear(params.fiscalYear, "fiscalYear");
    const q = params.fiscalQuarter || "Q1";
    if (!/^Q[1-4]$/.test(q)) {
      throw new ReportParamError("fiscalQuarter", "INVALID_FORMAT", "fiscalQuarter must be Q1-Q4");
    }
    const bounds = resolveFiscalQuarterBounds(y, q, fiscal.startMonth);
    return { start: bounds.start, end: bounds.end };
  }

  if (periodType === "Yearly") {
    const y = parseYear(params.fiscalYear, "fiscalYear");
    const bounds = resolveFiscalBounds(y, fiscal.startMonth, fiscal.endMonth);
    return { start: bounds.periodStart, end: bounds.periodEnd };
  }

  // Custom
  const start = parseIsoDate(params.startDate, "startDate");
  const end = parseIsoDate(params.endDate, "endDate");
  const endDateMatch = ISO_DATE_RE.exec(params.endDate as string)!;
  const endOfDay = new Date(Date.UTC(
    Number(endDateMatch[1]),
    Number(endDateMatch[2]) - 1,
    Number(endDateMatch[3]),
    23, 59, 59, 999,
  ));
  if (start.getTime() > endOfDay.getTime()) {
    throw new ReportParamError("endDate", "BEFORE_START", "endDate must not precede startDate");
  }
  return { start, end: endOfDay };
}

/** Cap on rows pulled into a single generated document (memory-bounded). */
export const REPORT_MAX_ROWS = 5000;
