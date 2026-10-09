import { describe, expect, it } from "vitest";
import {
  getReportDefinition,
  reportsForCategory,
  REPORT_TYPES,
  resolveReportPeriod,
  ReportParamError,
} from "./catalog";
import {
  createServerT,
  formatUtcDate,
  formatMoneyNumber,
  formatMoneyWithCurrency,
  monthKeyLabel,
  sumDecimal,
} from "./format";
import { buildCsv } from "./csv";
import type { ReportDocument } from "./data";

describe("report catalog", () => {
  it("has unique slugs across all categories", () => {
    const slugs = REPORT_TYPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("exposes exactly five categories with at least one report each", () => {
    expect(reportsForCategory("ledger").length).toBeGreaterThanOrEqual(4);
    expect(reportsForCategory("deposits").length).toBeGreaterThanOrEqual(3);
    expect(reportsForCategory("incomes").length).toBeGreaterThanOrEqual(3);
    expect(reportsForCategory("expenses").length).toBeGreaterThanOrEqual(2);
    expect(reportsForCategory("projects").length).toBeGreaterThanOrEqual(3);
  });

  it("marks entity reports as requiring a selector", () => {
    expect(getReportDefinition("project-ledger")?.requires).toBe("project");
    expect(getReportDefinition("member-history")?.requires).toBe("member");
    expect(getReportDefinition("fund-ledger")?.requires).toBe("fund");
    expect(getReportDefinition("comprehensive-ledger")?.requires).toBeUndefined();
  });
});

describe("resolveReportPeriod", () => {
  it("resolves a calendar month inclusive of its last day", () => {
    const { start, end } = resolveReportPeriod({ periodType: "Monthly", fiscalMonth: "2026-02" });
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    // 2026 is not a leap year — last day is Feb 28.
    expect(end.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });

  it("resolves a leap-year month", () => {
    const { end } = resolveReportPeriod({ periodType: "Monthly", fiscalMonth: "2024-02" });
    expect(end.toISOString()).toBe("2024-02-29T23:59:59.999Z");
  });

  it("rejects malformed months", () => {
    expect(() => resolveReportPeriod({ periodType: "Monthly", fiscalMonth: "2026-13" })).toThrow(ReportParamError);
    expect(() => resolveReportPeriod({ periodType: "Monthly", fiscalMonth: "2026/02" })).toThrow(ReportParamError);
  });

  it("resolves fiscal quarters against the tenant fiscal calendar (July start)", () => {
    const fiscal = { startMonth: "July", endMonth: "June" };
    // Q1 of FY2026 (starting July 2026) = Jul–Sep 2026.
    const q1 = resolveReportPeriod({ periodType: "Quarterly", fiscalQuarter: "Q1", fiscalYear: "2026" }, fiscal);
    expect(q1.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(q1.end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    // Q4 crosses the fiscal year boundary into June 2027.
    const q4 = resolveReportPeriod({ periodType: "Quarterly", fiscalQuarter: "Q4", fiscalYear: "2026" }, fiscal);
    expect(q4.start.toISOString()).toBe("2027-04-01T00:00:00.000Z");
    expect(q4.end.toISOString()).toBe("2027-06-30T23:59:59.999Z");
  });

  it("resolves a fiscal year spanning its start and end months", () => {
    const fiscal = { startMonth: "July", endMonth: "June" };
    const { start, end } = resolveReportPeriod({ periodType: "Yearly", fiscalYear: "2026" }, fiscal);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-06-30T23:59:59.999Z");
  });

  it("resolves a custom range and rejects an inverted one", () => {
    const { start, end } = resolveReportPeriod({
      periodType: "Custom",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-31T23:59:59.999Z");

    expect(() =>
      resolveReportPeriod({ periodType: "Custom", startDate: "2026-02-01", endDate: "2026-01-01" }),
    ).toThrow(ReportParamError);
    expect(() => resolveReportPeriod({ periodType: "Custom", startDate: "2026-02-01" })).toThrow(ReportParamError);
  });

  it("defaults to the current month when periodType is missing", () => {
    const { start, end } = resolveReportPeriod({});
    const now = new Date();
    expect(start.getUTCMonth()).toBe(now.getUTCMonth());
    expect(start.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("report formatters", () => {
  const t = createServerT("en");

  it("formats decimal strings with grouping and 2dp, no float round-trip", () => {
    expect(formatMoneyNumber("1234567.5")).toBe("1,234,567.50");
    expect(formatMoneyNumber("-1234.5")).toBe("-1,234.50");
    expect(formatMoneyNumber("0")).toBe("0.00");
    expect(formatMoneyNumber("")).toBe("");
    expect(formatMoneyNumber(null)).toBe("");
  });

  it("formats currency-prefixed summary values", () => {
    expect(formatMoneyWithCurrency("1250", "BDT")).toBe("BDT 1,250.00");
  });

  it("sums decimal strings exactly in cents (no 0.1+0.2 drift)", () => {
    expect(sumDecimal(["0.10", "0.20", "0.30"])).toBe("0.60");
    expect(sumDecimal(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });

  it("formats UTC dates against the tenant pattern including time", () => {
    expect(formatUtcDate("2026-10-05T14:30:00.000Z", "DD/MM/YYYY")).toBe("05/10/2026");
    expect(formatUtcDate("2026-10-05T14:30:00.000Z", "DD/MM/YYYY HH:mm")).toBe("05/10/2026 14:30");
    expect(formatUtcDate(null)).toBe("");
  });

  it("labels month keys with localized month names", () => {
    expect(monthKeyLabel("2026-01", t)).toBe("January 2026");
    expect(monthKeyLabel("bogus", t)).toBe("bogus");
  });
});

describe("buildCsv", () => {
  it("renders localized headers, raw values, UTF-8 BOM, and escapes quotes", () => {
    const doc = {
      slug: "member-history",
      title: "Member Deposit History",
      locale: "en" as const,
      currency: "BDT",
      dateFormat: "DD/MM/YYYY",
      letterhead: { name: "InvestWise" },
      periodLine: "Period: January 2026",
      generatedAt: "05/10/2026 14:30",
      generatedBy: "Admin",
      generatedByLabel: "Generated by",
      summary: [],
      columns: [
        { key: "member", label: "Member", type: "text" as const },
        { key: "amount", label: "Amount (BDT)", type: "money" as const, total: true },
      ],
      rows: [
        { member: 'Rafiq "Boss", Jr.', amount: "1500.50" },
        { member: "রফিক", amount: "0.10" },
      ],
      totalsLabel: "Total",
      truncated: false,
      truncatedNote: "",
      footerNote: "Confidential",
      fileBase: "member-history_2026-10-05",
    } satisfies ReportDocument;

    const csv = buildCsv(doc);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe('"Member","Amount (BDT)"');
    expect(lines[1]).toBe('"Rafiq ""Boss"", Jr.","1500.50"');
    expect(lines[2]).toBe('"রফিক","0.10"');
  });
});

describe("document builders (smoke)", () => {
  const baseDoc = (locale: ReportDocument["locale"]): ReportDocument => ({
    slug: "comprehensive-ledger",
    title: locale === "bn" ? "সাধারণ লেজার" : "General Ledger",
    locale,
    currency: "BDT",
    dateFormat: "DD/MM/YYYY",
    letterhead: { name: "InvestWise Ltd", tagline: "Enterprise Investment Management", address: "Dhaka", email: "ops@investwise.test", phone: "+8801000000000" },
    periodLine: "Period: October 2026",
    generatedAt: "05/10/2026 14:30",
    generatedBy: "Admin",
    generatedByLabel: "Generated by",
    summary: [
      { label: "Total Inflow", value: "BDT 2,000.00" },
      { label: "Total Outflow", value: "BDT 500.00" },
      { label: "Net Cash Flow", value: "BDT 1,500.00" },
    ],
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "member", label: "Member", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "debit", label: "Debit (BDT)", type: "money", total: true },
      { key: "credit", label: "Credit (BDT)", type: "money", total: true },
    ],
    rows: [
      { date: "2026-10-01T00:00:00.000Z", member: "Rafiq", description: "Deposit", debit: "0.00", credit: "1500.00" },
      { date: "2026-10-02T00:00:00.000Z", member: "Karim", description: "Expense", debit: "500.00", credit: "0.00" },
    ],
    totalsLabel: "Total",
    truncated: false,
    truncatedNote: "Note: truncated",
    footerNote: "Confidential",
    fileBase: "comprehensive-ledger_2026-10-05",
  });

  it("builds a real xlsx workbook buffer", async () => {
    const { buildExcelBuffer } = await import("./excel");
    const buffer = await buildExcelBuffer(baseDoc("en"));
    // XLSX is a ZIP container — starts with the PK magic bytes.
    expect(buffer.length).toBeGreaterThan(4000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    // Structural read-back: a totals row exists carrying the localized label
    // and numeric money cells. Located by content — the #104 3-row header cap
    // fixed the pre-table offsets, so arithmetic from rowCount is brittle.
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    if (!sheet) return;
    let sawTotalsRow = false;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === "Total") {
        sawTotalsRow = true;
        expect(row.getCell(4).value).toBe(500); // Debit total, numeric
        expect(row.getCell(5).value).toBe(1500); // Credit total, numeric
      }
    });
    expect(sawTotalsRow).toBe(true);
  });

  it("caps the pre-table header block at exactly 3 rows — #104", async () => {
    const { buildExcelBuffer } = await import("./excel");
    const buffer = await buildExcelBuffer(baseDoc("en"));
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    if (!sheet) return;
    // Row 1: company — report type. Row 2: period + provenance. Row 3: the
    // summary rollup joined on one line. Row 4: the table header. Row 5: data.
    // Even with a full letterhead (tagline + address + email + phone) and
    // three summary entries, the statement must start at row 5, not row 15.
    expect(sheet.getCell(1, 1).value).toBe("InvestWise Ltd — General Ledger");
    expect(String(sheet.getCell(2, 1).value)).toContain("Period: October 2026");
    expect(String(sheet.getCell(2, 1).value)).toContain("Generated by: Admin");
    expect(String(sheet.getCell(3, 1).value)).toContain("Total Inflow: BDT 2,000.00");
    expect(String(sheet.getCell(3, 1).value)).toContain("Net Cash Flow: BDT 1,500.00");
    expect(sheet.getCell(4, 1).value).toBe("Date");
    expect(sheet.getCell(4, 5).value).toBe("Credit (BDT)");
    expect(sheet.getCell(5, 2).value).toBe("Rafiq");
    // Frozen pane still includes the header row (ySplit = 4).
    expect((sheet.views[0] as { ySplit?: number } | undefined)?.ySplit).toBe(4);
  });

  it("builds a real PDF for every locale (embedded fonts load from disk)", async () => {
    const { buildPdfBytes } = await import("./pdf");
    for (const locale of ["en", "bn", "hi", "ur"] as const) {
      const bytes = await buildPdfBytes(baseDoc(locale));
      const header = bytes.subarray(0, 5).toString("latin1");
      expect(header).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("exports a date-only cell (no fractional time serial) — issue #59", async () => {
    const { buildExcelBuffer } = await import("./excel");
    const doc = baseDoc("en");
    doc.rows = [
      { date: "2026-10-09T00:00:36.504Z", member: "Rafiq", description: "Deposit", debit: "0.00", credit: "1500.00" },
    ];
    const buffer = await buildExcelBuffer(doc);
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    if (!sheet) return;
    // Find the data row carrying the date cell.
    let found: Date | null = null;
    sheet.eachRow((row) => {
      const v = row.getCell(1).value;
      if (v instanceof Date) found = v;
    });
    expect(found).not.toBeNull();
    const d = found as unknown as Date;
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});

describe("ledger debit/credit classification (issue #62)", () => {
  it("books real inflows as credits and real outflows as debits", async () => {
    const { classifyLedgerType } = await import("./data");
    expect(classifyLedgerType("Deposit")).toEqual({ debit: 0, credit: 1 });
    expect(classifyLedgerType("Earning")).toEqual({ debit: 0, credit: 1 });
    expect(classifyLedgerType("Expense")).toEqual({ debit: 1, credit: 0 });
    expect(classifyLedgerType("Transfer Out")).toEqual({ debit: 1, credit: 0 });
  });

  it("never books an unrecognised type as a credit (else 0/0)", async () => {
    const { classifyLedgerType } = await import("./data");
    // A dividend / unknown type must not inflate the credit column.
    expect(classifyLedgerType("Dividend")).toEqual({ debit: 1, credit: 0 });
    expect(classifyLedgerType("SomethingNew")).toEqual({ debit: 0, credit: 0 });
    expect(classifyLedgerType("")).toEqual({ debit: 0, credit: 0 });
  });

  it("lets each fund's own ledger reconstruct its balance after a dividend run (#97)", async () => {
    const { classifyLedgerType } = await import("./data");
    // The run debits the payout fund by the GROSS (reserve + distributed) and
    // credits the reserve fund by the reserve. Both legs must therefore be
    // signed, or a fund statement ends richer than the cash in the fund.
    expect(classifyLedgerType("Statutory Reserve")).toEqual({ debit: 0, credit: 1 });
    // The run-level aggregate is the sum of the per-member Dividend rows, so it
    // stays 0/0 — crediting it would count the same money twice.
    expect(classifyLedgerType("Dividend Distribution")).toEqual({ debit: 0, credit: 0 });
    // One sweep: out of the payout fund, into the reserve fund, net zero for the
    // tenant (no new money is created by moving it between two of its own funds).
    const out = classifyLedgerType("Transfer Out");
    const in_ = classifyLedgerType("Statutory Reserve");
    expect(in_.credit - out.debit).toBe(0);
  });
});
