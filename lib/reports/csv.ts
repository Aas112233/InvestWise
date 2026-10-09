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
