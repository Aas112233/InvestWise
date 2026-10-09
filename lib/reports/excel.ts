/**
 * Excel report builder (exceljs). Renders the enterprise template:
 * letterhead block, period + provenance lines, localized summary block,
 * styled data table (frozen header, autofilter, 2dp money columns,
 * totals row), right-to-left sheet for Urdu (Rule §10).
 */
import ExcelJS from "exceljs";
import type { ReportDocument } from "./data";
import { decimalToCents, sumDecimal } from "./format";

// Enterprise palette (hairline borders, muted fills — no emoji, no brights).
const HEADER_FILL = "FF1F2937"; // slate-800
const ZEBRA_FILL = "FFF3F4F6"; // gray-100
const TOTAL_FILL = "FFE5E7EB"; // gray-200
const TEXT_DARK = "FF111827";
const TEXT_MUTED = "FF6B7280";
const HAIRLINE = "FFD1D5DB";

const MONEY_FMT = "#,##0.00";
const NUMBER_FMT = "#,##0.00";

const isRtl = (locale: ReportDocument["locale"]) => locale === "ur";

function letterheadLineCount(doc: ReportDocument): number {
  // company + [tagline] + [contact] + title + period + generated + blank
  let lines = 1;
  if (doc.letterhead.tagline) lines += 1;
  if ([doc.letterhead.address, doc.letterhead.email, doc.letterhead.phone].some(Boolean)) lines += 1;
  return lines + 4;
}

function tableHeaderRowIndex(doc: ReportDocument): number {
  return letterheadLineCount(doc) + doc.summary.length + 1; // + trailing blank
}

function sanitizeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no []:*?/\
  return name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Report";
}

function borderAll(): ExcelJS.Borders {
  return {
    top: { style: "thin", color: { argb: HAIRLINE } },
    left: { style: "thin", color: { argb: HAIRLINE } },
    bottom: { style: "thin", color: { argb: HAIRLINE } },
    right: { style: "thin", color: { argb: HAIRLINE } },
    // Typing requires the key; an unstyled border draws nothing.
    diagonal: {},
  };
}

function applyCellValue(
  cell: ExcelJS.Cell,
  col: ReportDocument["columns"][number],
  value: string | number | null | undefined,
  doc: ReportDocument,
): void {
  if (value === null || value === undefined || value === "") {
    cell.value = "";
    return;
  }
  if (col.type === "money") {
    // Numeric cell with 2dp display format; the value itself is exact at 2dp.
    cell.value = decimalToCents(String(value)) / 100;
    cell.numFmt = MONEY_FMT;
    cell.alignment = { horizontal: "right" };
  } else if (col.type === "number") {
    cell.value = Number(value);
    cell.numFmt = NUMBER_FMT;
    cell.alignment = { horizontal: "right" };
  } else if (col.type === "date") {
    const raw = String(value);
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}/.test(raw)) {
      // Real date cell so users can filter/pivot; display in tenant format.
      // #59: strip the time component — a ledger date is a calendar date, and
      // leaving the time-of-day produces serials like 46304.00253940972 that
      // read as numeric noise in the cell.
      cell.value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      cell.numFmt = doc.dateFormat.toLowerCase();
      cell.alignment = { horizontal: "left" };
    } else {
      cell.value = raw;
      cell.alignment = { horizontal: "left" };
    }
  } else {
    cell.value = String(value);
    cell.alignment = { horizontal: "left" };
  }
}

export async function buildExcelBuffer(doc: ReportDocument): Promise<Buffer> {
  const rtl = isRtl(doc.locale);
  const lastCol = doc.columns.length;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = doc.letterhead.name;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sanitizeSheetName(doc.title), {
    views: [{ state: "frozen", ySplit: tableHeaderRowIndex(doc), rightToLeft: rtl }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: doc.columns.length > 7 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = doc.columns.map((c) => ({ key: c.key }));

  const putMuted = (cell: ExcelJS.Cell, value: string, opts: { bold?: boolean; size: number; italic?: boolean }) => {
    cell.value = value;
    cell.font = {
      name: "Calibri",
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      size: opts.size,
      color: { argb: TEXT_MUTED },
    };
    cell.alignment = { horizontal: rtl ? "right" : "left", vertical: "middle" };
  };
  const putStrong = (cell: ExcelJS.Cell, value: string, size: number) => {
    cell.value = value;
    cell.font = { name: "Calibri", bold: true, size, color: { argb: TEXT_DARK } };
    cell.alignment = { horizontal: rtl ? "right" : "left", vertical: "middle" };
  };

  let row = 1;

  // ── Letterhead ───────────────────────────────────────────────────
  sheet.mergeCells(row, 1, row, lastCol);
  putStrong(sheet.getCell(row, 1), doc.letterhead.name, 15);
  sheet.getRow(row).height = 22;
  row += 1;

  if (doc.letterhead.tagline) {
    sheet.mergeCells(row, 1, row, lastCol);
    putMuted(sheet.getCell(row, 1), doc.letterhead.tagline, { size: 9 });
    row += 1;
  }
  const contactLine = [doc.letterhead.address, doc.letterhead.email, doc.letterhead.phone]
    .filter(Boolean)
    .join("  |  ");
  if (contactLine) {
    sheet.mergeCells(row, 1, row, lastCol);
    putMuted(sheet.getCell(row, 1), contactLine, { size: 9 });
    row += 1;
  }

  // ── Title + period + provenance ──────────────────────────────────
  sheet.mergeCells(row, 1, row, lastCol);
  putStrong(sheet.getCell(row, 1), doc.title, 12);
  row += 1;

  sheet.mergeCells(row, 1, row, lastCol);
  putMuted(sheet.getCell(row, 1), doc.periodLine, { size: 10 });
  row += 1;

  sheet.mergeCells(row, 1, row, lastCol);
  putMuted(sheet.getCell(row, 1), `${doc.generatedAt}  |  ${doc.generatedByLabel}: ${doc.generatedBy}`, { size: 9 });
  row += 1;

  row += 1; // blank spacer

  // ── Summary block ────────────────────────────────────────────────
  for (const entry of doc.summary) {
    putMuted(sheet.getCell(row, 1), entry.label, { bold: true, size: 9 });
    sheet.mergeCells(row, 2, row, Math.max(2, Math.min(4, lastCol)));
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = entry.value;
    valueCell.font = { size: 10, bold: true, color: { argb: TEXT_DARK } };
    valueCell.alignment = { horizontal: rtl ? "right" : "left" };
    row += 1;
  }
  row += 1; // blank spacer

  // ── Table header ─────────────────────────────────────────────────
  const headerRowIndex = row;
  const headerRow = sheet.getRow(row);
  doc.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.label;
    cell.font = { size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = borderAll();
  });
  headerRow.height = 20;
  row += 1;

  // ── Data rows ────────────────────────────────────────────────────
  const totals = new Map<string, string>();
  for (const col of doc.columns) {
    if (col.total) {
      totals.set(col.key, sumDecimal(doc.rows.map((r) => r[col.key] as string | number | null)));
    }
  }

  doc.rows.forEach((dataRow, rowIdx) => {
    const sheetRow = sheet.getRow(row);
    doc.columns.forEach((col, idx) => {
      const cell = sheetRow.getCell(idx + 1);
      applyCellValue(cell, col, dataRow[col.key], doc);
      cell.font = { size: 9, color: { argb: TEXT_DARK } };
      cell.border = borderAll();
      if (rowIdx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_FILL } };
      }
    });
    row += 1;
  });

  // ── Totals row ───────────────────────────────────────────────────
  if (totals.size > 0 && doc.rows.length > 0) {
    const totalRow = sheet.getRow(row);
    doc.columns.forEach((col, idx) => {
      const cell = totalRow.getCell(idx + 1);
      if (idx === 0) {
        cell.value = doc.totalsLabel;
        cell.font = { size: 9, bold: true, color: { argb: TEXT_DARK } };
      } else if (totals.has(col.key)) {
        cell.value = decimalToCents(totals.get(col.key) ?? "0") / 100;
        cell.numFmt = MONEY_FMT;
        cell.font = { size: 9, bold: true, color: { argb: TEXT_DARK } };
        cell.alignment = { horizontal: "right" };
      }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
      cell.border = { ...borderAll(), top: { style: "double", color: { argb: HEADER_FILL } } };
    });
    row += 1;
  }

  // ── Footer notes ─────────────────────────────────────────────────
  row += 1;
  sheet.mergeCells(row, 1, row, lastCol);
  putMuted(sheet.getCell(row, 1), doc.footerNote, { size: 8, italic: true });
  if (doc.truncated) {
    row += 1;
    sheet.mergeCells(row, 1, row, lastCol);
    putMuted(sheet.getCell(row, 1), doc.truncatedNote, { size: 8, italic: true });
  }

  // ── Column widths from content (bounded) ─────────────────────────
  doc.columns.forEach((col, idx) => {
    const values = doc.rows.slice(0, 200).map((r) => String(r[col.key] ?? ""));
    const longest = values.reduce((max, v) => Math.max(max, v.length), col.label.length);
    sheet.getColumn(idx + 1).width = Math.min(Math.max(longest + 3, 10), 42);
  });

  if (doc.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + doc.rows.length, column: lastCol },
    };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
