/**
 * PDF report builder (pdfkit — fontkit shaping engine). Enterprise template:
 * letterhead + hairline rule, report title + period + provenance,
 * localized summary block, striped data table with repeated header,
 * totals row, and a per-page footer (page x/y, timestamp, confidentiality).
 *
 * Localized documents (Rule §10): non-Latin locales embed their Noto-family
 * font (Bengali / Devanagari / Naskh Arabic) at request time; Urdu tables
 * render right-aligned.
 *
 * Shaping (#106): pdfkit lays text out through fontkit's HarfBuzz-style
 * shapers, so Indic matra reordering (কি → matra before ka), conjunct
 * ligatures (ক্ক → one glyph) and Arabic joining all render correctly —
 * jsPDF could only emit base codepoints and garbled Indic scripts. The
 * document model (ReportDocument) is unchanged; only buildPdfBytes moved.
 */
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import type { ReportDocument } from "./data";
import { formatMoneyNumber, formatUtcDate, sumDecimal } from "./format";

interface PdfFont {
  file: string;
  family: string;
}

// Static Google-Fonts families that bundle Latin + the local script: one font
// per document, so every glyph in a mixed-script string (labels, names,
// money) exists in the same font. Script-only Noto builds render blanks for
// ASCII — do not swap them back in.
const LOCALE_FONTS: Partial<Record<ReportDocument["locale"], PdfFont>> = {
  bn: { file: "HindSiliguri-Regular.ttf", family: "HindSiliguri" },
  hi: { file: "Hind-Regular.ttf", family: "Hind" },
  ur: { file: "Amiri-Regular.ttf", family: "Amiri" },
};

const FONT_DIR = path.join(process.cwd(), "lib", "reports", "fonts");
const fontCache = new Map<string, Buffer>();

function loadFontBuffer(file: string): Buffer | null {
  const cached = fontCache.get(file);
  if (cached) return cached;
  try {
    const buf = fs.readFileSync(path.join(FONT_DIR, file));
    fontCache.set(file, buf);
    return buf;
  } catch (error) {
    // Missing/unreadable font file: degrade to Helvetica instead of failing
    // the export (Latin-only fallback; non-Latin glyphs would not render).
    console.error(`[reports/pdf] font unavailable: ${file}`, error);
    return null;
  }
}

// Enterprise palette (hairline borders, muted fills — no emoji, no brights).
const DARK = "#111827"; // gray-900
const MUTED = "#6B7280"; // gray-500
const HEADER_BG = "#1F2937"; // slate-800
const ZEBRA_BG = "#F3F4F6"; // gray-100
const TOTAL_BG = "#E5E7EB"; // gray-200
const RULE = "#D1D5DB"; // gray-300
const WHITE = "#FFFFFF";

const MM = 2.83465; // pt per mm — the template's measurements stay in mm
const MARGIN = 12 * MM;
const TABLE_BOTTOM = 16 * MM; // footer zone reserved below the table
const HEAD_FS = 7;
const BODY_FS = 6.8;
const PAD_X = 3.2;
const PAD_Y = 2.6;
// #110: column width policy. Reference/ID-style values (PRJ-EXP-20261009-…)
// used to inflate their column's desired width and squeeze every other
// column. Widths are now capped: long values wrap onto extra lines instead
// of hogging the page, while normal columns keep dynamic spacing.
const COL_MIN_PT = 18;
const COL_MAX_PT = 55 * MM;

export async function buildPdfBytes(doc: ReportDocument): Promise<Buffer> {
  const landscape = doc.columns.length > 7;
  const pdf = new PDFDocument({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: doc.title, Creator: "InvestWise" },
  });
  pdf.lineGap(0);

  // Font: localized families get the embedded TTF under explicit names
  // (regular + bold alias the same file — no bold cut exists, and pdfkit
  // otherwise warns and falls back when a style is requested unregistered).
  const fontInfo = LOCALE_FONTS[doc.locale];
  let regName = "Helvetica";
  let boldName = "Helvetica-Bold";
  if (fontInfo) {
    const buf = loadFontBuffer(fontInfo.file);
    if (buf) {
      pdf.registerFont(fontInfo.family, buf);
      pdf.registerFont(`${fontInfo.family}:bold`, buf);
      regName = fontInfo.family;
      boldName = `${fontInfo.family}:bold`;
    }
  }
  const selectFont = (weight: "normal" | "bold") => {
    pdf.font(weight === "bold" ? boldName : regName);
    return pdf;
  };

  const pageWidth = pdf.page.width;
  const pageHeight = pdf.page.height;
  const contentWidth = pageWidth - MARGIN * 2;
  const rtl = doc.locale === "ur";
  const baseAlign: "left" | "right" = rtl ? "right" : "left";

  // Single-line draw (letterhead/title/provenance/footers). y = top of line.
  const line = (
    str: string,
    y: number,
    opts: { size: number; color: string; weight?: "normal" | "bold"; align?: "left" | "right" },
  ) => {
    selectFont(opts.weight ?? "normal").fontSize(opts.size).fillColor(opts.color);
    pdf.text(str, MARGIN, y, {
      width: contentWidth,
      align: opts.align ?? baseAlign,
      lineBreak: false,
    });
  };

  let cursorY = MARGIN;

  // ── Letterhead (first page) ──────────────────────────────────────
  line(doc.letterhead.name, cursorY, { size: 15, color: DARK });
  cursorY += 7 * MM;

  if (doc.letterhead.tagline) {
    line(doc.letterhead.tagline, cursorY, { size: 8, color: MUTED });
    cursorY += 4.5 * MM;
  }
  const contactLine = [doc.letterhead.address, doc.letterhead.email, doc.letterhead.phone]
    .filter(Boolean)
    .join("  |  ");
  if (contactLine) {
    line(contactLine, cursorY, { size: 8, color: MUTED });
    cursorY += 4.5 * MM;
  }

  pdf
    .moveTo(MARGIN, cursorY + 2 * MM)
    .lineTo(pageWidth - MARGIN, cursorY + 2 * MM)
    .lineWidth(0.3)
    .strokeColor(RULE)
    .stroke();
  cursorY += 6 * MM;

  // ── Title block ──────────────────────────────────────────────────
  line(doc.title, cursorY, { size: 12, color: DARK });
  cursorY += 6.5 * MM;
  line(doc.periodLine, cursorY, { size: 8.5, color: MUTED });
  cursorY += 4.5 * MM;
  line(`${doc.generatedAt}  |  ${doc.generatedByLabel}: ${doc.generatedBy}`, cursorY, {
    size: 8.5,
    color: MUTED,
  });
  cursorY += 6 * MM;

  // ── Summary block (plain label/value rows) ───────────────────────
  if (doc.summary.length > 0) {
    const valueX = MARGIN + 55 * MM;
    for (const entry of doc.summary) {
      selectFont("normal").fontSize(8.5).fillColor(MUTED);
      pdf.text(entry.label, MARGIN, cursorY, { width: 55 * MM, align: baseAlign, lineBreak: false });
      selectFont("bold").fontSize(8.5).fillColor(DARK);
      pdf.text(entry.value, valueX, cursorY, { lineBreak: false });
      cursorY += 4.8 * MM;
    }
    cursorY += 5 * MM;
  }

  // ── Main data table ──────────────────────────────────────────────
  const cols = doc.columns;
  const moneyIdx = new Set(
    cols.map((c, i) => (c.type === "money" || c.type === "number" ? i : -1)).filter((i) => i >= 0),
  );
  const totalKeys = new Set(cols.filter((c) => c.total).map((c) => c.key));

  const bodyRows = doc.rows.map((row) => cols.map((c) => renderCell(row[c.key], c.type, doc)));
  const hasTotals = totalKeys.size > 0 && doc.rows.length > 0;
  if (hasTotals) {
    bodyRows.push(
      cols.map((c, i) => {
        if (totalKeys.has(c.key)) {
          const total = sumDecimal(doc.rows.map((r) => r[c.key] as string | number | null));
          return formatMoneyNumber(total);
        }
        return i === 0 ? doc.totalsLabel : "";
      }),
    );
  }

  // Column widths: measure with the FINAL font at body size, clamp each to
  // [MIN, MAX] (#110 — long references wrap instead of hogging), then fit the
  // set to the content width: shrink proportionally when over, grow columns
  // toward the cap when under (never stretching a capped column further).
  selectFont("normal").fontSize(BODY_FS);
  const widthOf = (s: string) => pdf.widthOfString(String(s ?? ""));
  const desired = cols.map((c, i) => {
    let w = widthOf(c.label);
    for (const row of doc.rows) w = Math.max(w, widthOf(renderCell(row[c.key], c.type, doc)));
    if (hasTotals && totalKeys.has(c.key)) {
      w = Math.max(
        w,
        widthOf(formatMoneyNumber(sumDecimal(doc.rows.map((r) => r[c.key] as string | number | null)))),
      );
    }
    return Math.min(Math.max(w + PAD_X * 2, COL_MIN_PT), COL_MAX_PT);
  });
  const widths = fitWidths(desired, contentWidth, COL_MIN_PT, COL_MAX_PT);
  const colX = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0) + MARGIN);

  // #110: pdfkit wraps on whitespace only, so one long unbreakable token
  // (a reference, a UUID) would overflow a capped column horizontally. Chunk
  // any token wider than the usable cell width into fitting pieces joined by
  // spaces — the visible result is a value wrapped across lines.
  const chunkForWidth = (s: string, i: number, size: number): string => {
    const usable = (widths[i] ?? contentWidth) - PAD_X * 2;
    if (usable <= 4) return s;
    pdf.fontSize(size);
    const tokens = String(s ?? "").split(" ");
    const out: string[] = [];
    for (const token of tokens) {
      if (pdf.widthOfString(token) <= usable) {
        out.push(token);
        continue;
      }
      let rest = token;
      while (pdf.widthOfString(rest) > usable && rest.length > 1) {
        let fit = rest.length - 1;
        while (fit > 1 && pdf.widthOfString(rest.slice(0, fit)) > usable) fit -= 1;
        if (fit <= 1) break;
        out.push(rest.slice(0, fit));
        rest = rest.slice(fit);
      }
      out.push(rest);
    }
    return out.join(" ");
  };

  const headerHeight = HEAD_FS * 1.45 + PAD_Y * 2;

  const drawTableHeader = (y: number): number => {
    pdf.rect(MARGIN, y, contentWidth, headerHeight).fill(HEADER_BG);
    selectFont("normal").fontSize(HEAD_FS).fillColor(WHITE);
    cols.forEach((c, i) => {
      const x = colX[i] ?? MARGIN;
      const w = widths[i] ?? contentWidth;
      const label = chunkForWidth(c.label, i, HEAD_FS);
      pdf.text(label, x + PAD_X, y + PAD_Y, {
        width: w - PAD_X * 2,
        align: moneyIdx.has(i) ? "right" : baseAlign,
        lineBreak: false,
      });
    });
    return y + headerHeight;
  };

  const startTablePage = (): number => {
    pdf.addPage({
      margins: { top: 18 * MM, bottom: TABLE_BOTTOM, left: MARGIN, right: MARGIN },
    });
    // Slim running header on continuation pages.
    selectFont("normal").fontSize(7).fillColor(MUTED);
    pdf.text(doc.letterhead.name, MARGIN, 24, { width: contentWidth, align: baseAlign, lineBreak: false });
    pdf.text(doc.title, MARGIN, 24, { width: contentWidth, align: rtl ? "left" : "right", lineBreak: false });
    let y = 18 * MM;
    return drawTableHeader(y);
  };

  let y = cursorY;
  if (y + headerHeight > pageHeight - TABLE_BOTTOM) {
    y = startTablePage();
  } else {
    y = drawTableHeader(y);
  }

  for (let r = 0; r < bodyRows.length; r += 1) {
    const isTotals = hasTotals && r === bodyRows.length - 1;
    const cells = bodyRows[r] ?? [];
    selectFont(isTotals ? "bold" : "normal").fontSize(BODY_FS);
    const wrapped = cells.map((cell, i) => chunkForWidth(cell ?? "", i, BODY_FS));
    const heights = cols.map((c, i) =>
      pdf.heightOfString(wrapped[i] ?? "", { width: (widths[i] ?? contentWidth) - PAD_X * 2 }),
    );
    const rowHeight = Math.max(...heights, BODY_FS * 1.3) + PAD_Y * 2;
    if (y + rowHeight > pageHeight - TABLE_BOTTOM) {
      y = startTablePage();
      selectFont(isTotals ? "bold" : "normal").fontSize(BODY_FS);
    }
    if (isTotals) {
      pdf.rect(MARGIN, y, contentWidth, rowHeight).fill(TOTAL_BG);
    } else if (r % 2 === 1) {
      pdf.rect(MARGIN, y, contentWidth, rowHeight).fill(ZEBRA_BG);
    }
    selectFont(isTotals ? "bold" : "normal").fontSize(BODY_FS).fillColor(DARK);
    cols.forEach((c, i) => {
      const x = colX[i] ?? MARGIN;
      const w = widths[i] ?? contentWidth;
      pdf.text(wrapped[i] ?? "", x + PAD_X, y + PAD_Y, {
        width: w - PAD_X * 2,
        align: moneyIdx.has(i) ? "right" : baseAlign,
      });
    });
    y += rowHeight;
  }

  // ── Footers (page x/y + confidentiality) ─────────────────────────
  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p += 1) {
    pdf.switchToPage(p);
    const h = pdf.page.height;
    pdf
      .moveTo(MARGIN, h - 9 * MM)
      .lineTo(pageWidth - MARGIN, h - 9 * MM)
      .lineWidth(0.2)
      .strokeColor(RULE)
      .stroke();
    selectFont("normal").fontSize(6.5).fillColor(MUTED);
    pdf.text(doc.footerNote, MARGIN, h - 5.5 * MM - 1.5, {
      width: contentWidth * 0.7,
      align: "left",
      lineBreak: false,
    });
    pdf.text(`${doc.generatedAt}  |  ${p + 1} / ${range.count}`, MARGIN + contentWidth * 0.3, h - 5.5 * MM - 1.5, {
      width: contentWidth * 0.7,
      align: "right",
      lineBreak: false,
    });
  }

  pdf.end();

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  return done;
}

function renderCell(value: string | number | null | undefined, type: ReportDocument["columns"][number]["type"], doc: ReportDocument): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "money") return formatMoneyNumber(String(value));
  if (type === "number") return formatMoneyNumber(typeof value === "number" ? value : Number(value));
  if (type === "date") return formatUtcDate(String(value), doc.dateFormat);
  return String(value);
}

/**
 * #110: fit measured column widths to the content width without letting one
 * long-value column hog the page. Columns arrive clamped to [min, max];
 * shrink proportionally when the set overflows, grow toward the cap when it
 * underflows (headroom-weighted), and spread any remainder equally once every
 * column sits at the cap.
 */
function fitWidths(desired: number[], contentWidth: number, min: number, max: number): number[] {
  const widths = desired.map((w) => Math.min(Math.max(w, min), max));
  const sum = widths.reduce((a, b) => a + b, 0);
  let diff = contentWidth - sum;
  if (diff > 0.5) {
    const headroom = widths.map((w) => Math.max(0, max - w));
    const room = headroom.reduce((a, b) => a + b, 0);
    if (room > 0) {
      const take = Math.min(diff, room);
      for (let i = 0; i < widths.length; i += 1) {
        widths[i] = (widths[i] ?? 0) + take * ((headroom[i] ?? 0) / room);
      }
      diff -= take;
    }
    if (diff > 0.5 && widths.length > 0) {
      const extra = diff / widths.length;
      for (let i = 0; i < widths.length; i += 1) {
        widths[i] = (widths[i] ?? 0) + extra;
      }
    }
  } else if (diff < -0.5) {
    const scale = contentWidth / sum;
    for (let i = 0; i < widths.length; i += 1) {
      widths[i] = Math.max((widths[i] ?? 0) * scale, min);
    }
  }
  return widths;
}
