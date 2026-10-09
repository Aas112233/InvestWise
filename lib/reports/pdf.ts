/**
 * PDF report builder (jspdf + jspdf-autotable). Enterprise template:
 * letterhead + hairline rule, report title + period + provenance,
 * localized summary block, striped data table with repeated header,
 * totals row, and a per-page footer (page x/y, timestamp, confidentiality).
 *
 * Localized documents (Rule §10): non-Latin locales embed their Noto font
 * (Bengali / Devanagari / Naskh Arabic) at request time; Urdu tables render
 * right-aligned.
 *
 * ponytail: jsPDF has no complex-script shaping engine, so Indic conjuncts
 * and Arabic joining render as base glyphs (correct characters, imperfect
 * ligatures). Upgrade path: @react-pdf/renderer (fontkit shaping) or a
 * browser print pipeline — swap buildPdfBytes, the document model stays.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "node:fs";
import path from "node:path";
import type { ReportDocument } from "./data";
import { formatMoneyNumber, formatUtcDate, sumDecimal } from "./format";

interface PdfFont {
  file: string;
  family: string;
}

// Static Google-Fonts families that bundle Latin + the local script: jsPDF
// uses one font per draw call, so every glyph in a mixed-script string
// (labels, names, money) must exist in the same font. Script-only Noto
// builds render blanks for ASCII — do not swap them back in.
const LOCALE_FONTS: Partial<Record<ReportDocument["locale"], PdfFont>> = {
  bn: { file: "HindSiliguri-Regular.ttf", family: "HindSiliguri" },
  hi: { file: "Hind-Regular.ttf", family: "Hind" },
  ur: { file: "Amiri-Regular.ttf", family: "Amiri" },
};

const FONT_DIR = path.join(process.cwd(), "lib", "reports", "fonts");
const base64Cache = new Map<string, string>();

function loadFontBase64(file: string): string | null {
  const cached = base64Cache.get(file);
  if (cached) return cached;
  try {
    const ttf = fs.readFileSync(path.join(FONT_DIR, file));
    const base64 = Buffer.from(ttf).toString("base64");
    base64Cache.set(file, base64);
    return base64;
  } catch (error) {
    // Missing/unreadable font file (e.g. tracing misconfigured on the edge
    // case deploy): degrade to Helvetica instead of failing the export.
    console.error(`[reports/pdf] font unavailable: ${file}`, error);
    return null;
  }
}

const DARK: [number, number, number] = [17, 24, 39]; // gray-900
const MUTED: [number, number, number] = [107, 114, 128]; // gray-500
const HEADER_BG: [number, number, number] = [31, 41, 55]; // gray-800
const ZEBRA_BG: [number, number, number] = [243, 244, 246]; // gray-100
const TOTAL_BG: [number, number, number] = [229, 231, 235]; // gray-200
const RULE: [number, number, number] = [209, 213, 219]; // gray-300

export async function buildPdfBytes(doc: ReportDocument): Promise<Buffer> {
  const landscape = doc.columns.length > 7;
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });

  const font = LOCALE_FONTS[doc.locale];
  let family = "helvetica";
  if (font) {
    const base64 = loadFontBase64(font.file);
    if (base64) {
      pdf.addFileToVFS(font.file, base64);
      // Single weight registered under every style label: jsPDF otherwise
      // falls back with a lookup warning whenever autoTable asks for bold.
      pdf.addFont(font.file, font.family, "normal");
      pdf.addFont(font.file, font.family, "bold");
      pdf.addFont(font.file, font.family, "italic");
      pdf.addFont(font.file, font.family, "bolditalic");
      family = font.family;
    }
  }

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const rtl = doc.locale === "ur";
  const baseAlign = rtl ? "right" : "left";

  let cursorY = margin;

  // ── Letterhead (first page) ──────────────────────────────────────
  pdf.setFont(family, "normal").setFontSize(15).setTextColor(...DARK);
  pdf.text(doc.letterhead.name, rtl ? pageWidth - margin : margin, cursorY + 4, { align: baseAlign });
  cursorY += 7;

  pdf.setFontSize(8).setTextColor(...MUTED);
  if (doc.letterhead.tagline) {
    pdf.text(doc.letterhead.tagline, rtl ? pageWidth - margin : margin, cursorY + 3, { align: baseAlign });
    cursorY += 4.5;
  }
  const contactLine = [doc.letterhead.address, doc.letterhead.email, doc.letterhead.phone]
    .filter(Boolean)
    .join("  |  ");
  if (contactLine) {
    pdf.text(contactLine, rtl ? pageWidth - margin : margin, cursorY + 3, { align: baseAlign });
    cursorY += 4.5;
  }

  pdf.setDrawColor(...RULE).setLineWidth(0.3);
  pdf.line(margin, cursorY + 2, pageWidth - margin, cursorY + 2);
  cursorY += 6;

  // ── Title block ──────────────────────────────────────────────────
  pdf.setFont(family, "normal").setFontSize(12).setTextColor(...DARK);
  pdf.text(doc.title, rtl ? pageWidth - margin : margin, cursorY + 4, { align: baseAlign });
  cursorY += 6.5;

  pdf.setFontSize(8.5).setTextColor(...MUTED);
  pdf.text(doc.periodLine, rtl ? pageWidth - margin : margin, cursorY + 3, { align: baseAlign });
  cursorY += 4.5;
  pdf.text(`${doc.generatedAt}  |  ${doc.generatedByLabel}: ${doc.generatedBy}`, rtl ? pageWidth - margin : margin, cursorY + 3, { align: baseAlign });
  cursorY += 6;

  // ── Summary block ────────────────────────────────────────────────
  if (doc.summary.length > 0) {
    autoTable(pdf, {
      body: doc.summary.map((entry) => [entry.label, entry.value]),
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: "plain",
      styles: { font: family, fontSize: 8.5, cellPadding: 0.8, textColor: DARK },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: "normal", textColor: MUTED },
        1: { fontStyle: "bold", textColor: DARK },
      },
    });
    const afterSummary = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    cursorY = (afterSummary?.finalY ?? cursorY) + 5;
  }

  // ── Main data table ──────────────────────────────────────────────
  const moneyColIndexes = doc.columns
    .map((c, i) => (c.type === "money" || c.type === "number" ? i : -1))
    .filter((i) => i >= 0);
  const totalKeys = new Set(doc.columns.filter((c) => c.total).map((c) => c.key));

  const body = doc.rows.map((row) =>
    doc.columns.map((col) => renderCell(row[col.key], col.type, doc)),
  );
  const hasTotals = totalKeys.size > 0 && doc.rows.length > 0;
  if (hasTotals) {
    body.push(
      doc.columns.map((col, i) => {
        if (totalKeys.has(col.key)) {
          const total = sumDecimal(doc.rows.map((r) => r[col.key] as string | number | null));
          return formatMoneyNumber(total);
        }
        return i === 0 ? doc.totalsLabel : "";
      }),
    );
  }

  autoTable(pdf, {
    head: [doc.columns.map((c) => c.label)],
    body,
    startY: cursorY,
    margin: { left: margin, right: margin, top: 18, bottom: 16 },
    styles: { font: family, fontSize: 6.8, cellPadding: 1.1, textColor: DARK, overflow: "linebreak", halign: baseAlign },
    headStyles: { font: family, fillColor: HEADER_BG, textColor: [255, 255, 255], fontSize: 7, fontStyle: "normal" },
    alternateRowStyles: { fillColor: ZEBRA_BG },
    columnStyles: Object.fromEntries(
      moneyColIndexes.map((i) => [i, { halign: "right" as const }]),
    ),
    didParseCell: (data) => {
      const isTotalsRow = data.section === "body" && hasTotals && data.row.index === body.length - 1;
      if (isTotalsRow) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = TOTAL_BG;
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        // Slim running header on continuation pages.
        pdf.setFont(family, "normal").setFontSize(7).setTextColor(...MUTED);
        pdf.text(doc.letterhead.name, rtl ? pageWidth - margin : margin, margin - 4, { align: baseAlign });
        pdf.text(doc.title, rtl ? margin : pageWidth - margin, margin - 4, { align: rtl ? "left" : "right" });
      }
    },
  });

  // ── Footers (page x/y + confidentiality) ─────────────────────────
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...RULE).setLineWidth(0.2);
    pdf.line(margin, pageHeight - 9, pageWidth - margin, pageHeight - 9);
    pdf.setFont(family, "normal").setFontSize(6.5).setTextColor(...MUTED);
    pdf.text(doc.footerNote, margin, pageHeight - 5.5, { align: "left" });
    pdf.text(`${doc.generatedAt}  |  ${page} / ${pageCount}`, pageWidth - margin, pageHeight - 5.5, { align: "right" });
  }

  return Buffer.from(pdf.output("arraybuffer"));
}

function renderCell(value: string | number | null | undefined, type: ReportDocument["columns"][number]["type"], doc: ReportDocument): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "money") return formatMoneyNumber(String(value));
  if (type === "number") return formatMoneyNumber(typeof value === "number" ? value : Number(value));
  if (type === "date") return formatUtcDate(String(value), doc.dateFormat);
  return String(value);
}
