/**
 * CSV report renderer: localized headers, raw machine-readable values
 * (ISO dates, decimal(15,2) money), UTF-8 BOM for Excel compatibility.
 */
import type { ReportDocument } from "./data";

function escapeCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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
