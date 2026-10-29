/**
 * CSV report renderer: localized headers, raw machine-readable values
 * (ISO dates, decimal(15,2) money), UTF-8 BOM for Excel compatibility.
 */
import type { ReportDocument } from "./data";

// CSV formula injection (audit 07 M-4): a cell starting with =, +, -, @, tab
// or CR becomes a live formula when the export is opened in Excel/Sheets.
// Neutralize by prefixing a single quote — except plain negative numbers
// ("-1250.50"), which are legitimate money values in every finance export.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;

export function neutralizeCsvFormula(value: string): string {
  if (!CSV_FORMULA_PREFIX.test(value)) return value;
  if (PLAIN_NEGATIVE_NUMBER.test(value)) return value;
  return `'${value}`;
}

function escapeCsvValue(value: string): string {
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`;
}

export function buildCsv(doc: ReportDocument): string {
  const lines: string[] = [];
  const cell = (value: string | null | undefined) => escapeCsvValue(value ?? "");

  // Attribution header: a downloaded CSV must say what it is, which period
  // and scope it covers, and who generated it — a bare table is an
  // unattributable artifact. Every value below already comes from the
  // localized ReportDocument, so no new strings.
  lines.push([cell(doc.letterhead.name), cell(doc.title)].join(","));
  lines.push(cell(doc.periodLine));
  lines.push([cell(doc.generatedByLabel), cell(doc.generatedBy), cell(doc.generatedAt)].join(","));
  // Summary values are tenant data (member names can contain commas) — every
  // cell goes through the same escaping as the table.
  for (const entry of doc.summary) lines.push([cell(entry.label), cell(entry.value)].join(","));
  lines.push("");

  const headers = doc.columns.map((c) => escapeCsvValue(c.label));
  lines.push(headers.join(","));

  for (const row of doc.rows) {
    lines.push(
      doc.columns
        .map((col) => {
          const value = row[col.key];
          if (value === null || value === undefined) return '""';
          const str = typeof value === "object" ? JSON.stringify(value) : String(value);
          return escapeCsvValue(str);
        })
        .join(","),
    );
  }

  // UTF-8 BOM so Excel opens Bengali/Hindi/Urdu text correctly.
  return "\uFEFF" + lines.join("\r\n");
}
