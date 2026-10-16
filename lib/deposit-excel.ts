import type { Border, Fill } from "exceljs";
import { MoneyError, fromCents, normalizeBanglaDigits, parsePositiveAmount } from "./money";

// Browser-only Excel round trip; the bulk deposit endpoint re-validates whatever is submitted.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_TEMPLATE_BYTES = 1024 * 1024;
export const MAX_TEMPLATE_ROWS = 500;
export const MAX_DEPOSIT_AMOUNT = 10_000_000;

const KIND = "investwise.bulk-deposit";
const VERSION = 1;
const META_SHEET = "iw_meta";
const KEY_MARKER = "iw:key";
const META_FIRST_MEMBER_ROW = 6;
const AMOUNT_TEXT = /^\d+(\.\d{1,2})?$/;

export type TemplateErrorCode =
  | "notXlsx"
  | "tooLarge"
  | "unreadable"
  | "notTemplate"
  | "wrongTenant"
  | "noRows"
  | "tooManyRows";

export class TemplateError extends Error {
  code: TemplateErrorCode;
  constructor(code: TemplateErrorCode) {
    super(code);
    this.name = "TemplateError";
    this.code = code;
  }
}

export interface TemplateMember {
  id: string;
  memberId: string;
  name: string;
  shares: number;
}

export interface TemplateLabels {
  sheetName: string;
  instructionsSheetName: string;
  memberId: string;
  name: string;
  shares: string;
  amount: string;
  instructionsTitle: string;
  instructions: string[];
  amountErrorTitle: string;
  amountError: string;
}

/** The locked identity of a row, as text. */
interface Snapshot {
  memberId: string;
  name: string;
  shares: string;
}

export interface TemplateRow extends Snapshot {
  row: number;
  key: string | null;
  amount: string | number | null;
}

export interface TemplateData {
  tenantId: string;
  originals: Map<string, Snapshot>;
  rows: TemplateRow[];
}

export interface LiveMember {
  id: string;
  memberId: string;
  name: string;
  status: string;
  shares?: number;
}

export type FieldName = keyof Snapshot;

export interface FieldChange {
  field: FieldName;
  from: string;
  to: string;
}

export type FlagCode =
  | "notInTemplate"
  | "duplicate"
  | "stale"
  | "missing"
  | "inactive"
  | "invalidAmount"
  | "tooLarge"
  | "alreadyPaid";

export type FlagReason = { code: "changed"; fields: FieldChange[] } | { code: FlagCode };

export interface ReviewRow extends Snapshot {
  row: number;
  amountCents: number | null;
}

export interface ReadyRow extends ReviewRow {
  key: string;
  amountCents: number;
}

export interface FlaggedRow extends ReviewRow {
  reasons: FlagReason[];
}

export interface ImportReview {
  ready: ReadyRow[];
  flagged: FlaggedRow[];
  skipped: number;
  totalCents: number;
}

const HEADER_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const LOCKED_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
const INPUT_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
const THIN: Partial<Border> = { style: "thin", color: { argb: "FFCBD5E1" } };
const FIELDS: FieldName[] = ["memberId", "name", "shares"];

// ~1 MB library, loaded only when the user actually downloads or uploads.
const loadExcel = async () => (await import("exceljs")).default;

const sheetName = (name: string, fallback: string) =>
  name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || fallback;

function plainValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return null;
  const cell = value as Record<string, unknown>;
  // Formulas are never evaluated; only the value Excel cached when saving counts.
  if ("formula" in cell || "sharedFormula" in cell) {
    return cell.result === undefined ? "#FORMULA" : plainValue(cell.result);
  }
  if ("error" in cell) return String(cell.error);
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("");
  }
  if ("text" in cell) return plainValue(cell.text);
  return null;
}

function cellText(value: unknown): string {
  const plain = plainValue(value);
  return plain === null ? "" : String(plain).trim();
}

export async function buildDepositTemplate(opts: {
  members: TemplateMember[];
  shareValueCents: number | null;
  tenantId: string | null;
  labels: TemplateLabels;
  rtl?: boolean;
}): Promise<ArrayBuffer> {
  const { members, shareValueCents, labels } = opts;
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "InvestWise";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName(labels.sheetName, "Deposits"), {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: !!opts.rtl }],
  });
  ws.columns = [
    { header: labels.memberId, width: 16 },
    { header: labels.name, width: 34 },
    { header: labels.shares, width: 10 },
    { header: labels.amount, width: 18 },
    { header: KEY_MARKER, width: 10 },
  ];
  ws.getColumn(5).hidden = true;
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: THIN };
  });

  for (const m of members) {
    const amount =
      shareValueCents !== null && m.shares > 0 ? Number(fromCents(shareValueCents * m.shares)) : null;
    const row = ws.addRow([m.memberId, m.name, m.shares, amount, m.id]);
    for (const col of [1, 2, 3]) {
      const cell = row.getCell(col);
      cell.fill = LOCKED_FILL;
      cell.font = { color: { argb: "FF475569" } };
    }
    const input = row.getCell(4);
    input.numFmt = "#,##0.00";
    input.fill = INPUT_FILL;
    input.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    input.protection = { locked: false };
    input.dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0, MAX_DEPOSIT_AMOUNT],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: labels.amountErrorTitle,
      error: labels.amountError,
    };
  }
  // Convenience lock only; readDepositTemplate re-verifies every locked value.
  await ws.protect(crypto.randomUUID(), { spinCount: 1000 });

  const help = wb.addWorksheet(sheetName(labels.instructionsSheetName, "Instructions"), {
    views: [{ rightToLeft: !!opts.rtl }],
  });
  help.getColumn(1).width = 110;
  help.addRow([labels.instructionsTitle]).font = { bold: true, size: 13 };
  help.addRow([]);
  labels.instructions.forEach((line, i) => {
    help.addRow([`${i + 1}. ${line}`]).alignment = { wrapText: true, vertical: "top" };
  });

  // Issued identity per row: tells a file edit apart from a record changed after download.
  const meta = wb.addWorksheet(META_SHEET, { state: "veryHidden" });
  meta.addRows([
    ["kind", KIND],
    ["version", VERSION],
    ["tenant", opts.tenantId ?? ""],
    ["generated", new Date().toISOString()],
    ["key", "memberId", "name", "shares"],
    ...members.map((m) => [m.id, m.memberId, m.name, m.shares]),
  ]);
  await meta.protect(crypto.randomUUID(), { spinCount: 1000 });

  return wb.xlsx.writeBuffer();
}

export async function readDepositTemplate(file: File): Promise<TemplateData> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new TemplateError("notXlsx");
  // Parsing is local, so a hostile file can only stall this tab; the cap bounds that.
  if (file.size > MAX_TEMPLATE_BYTES) throw new TemplateError("tooLarge");

  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new TemplateError("unreadable");
  }

  const meta = wb.getWorksheet(META_SHEET);
  const ws = wb.worksheets.find(
    (sheet) => sheet.name !== META_SHEET && cellText(sheet.getCell("E1").value) === KEY_MARKER,
  );
  if (
    !meta ||
    !ws ||
    cellText(meta.getCell("B1").value) !== KIND ||
    cellText(meta.getCell("B2").value) !== String(VERSION)
  ) {
    throw new TemplateError("notTemplate");
  }

  const originals = new Map<string, Snapshot>();
  meta.eachRow((row, rowNumber) => {
    if (rowNumber < META_FIRST_MEMBER_ROW) return;
    const key = cellText(row.getCell(1).value);
    if (!key) return;
    originals.set(key, {
      memberId: cellText(row.getCell(2).value),
      name: cellText(row.getCell(3).value),
      shares: cellText(row.getCell(4).value),
    });
  });

  const rows: TemplateRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const amount = plainValue(row.getCell(4).value);
    const entry: TemplateRow = {
      row: rowNumber,
      memberId: cellText(row.getCell(1).value),
      name: cellText(row.getCell(2).value),
      shares: cellText(row.getCell(3).value),
      key: cellText(row.getCell(5).value) || null,
      amount: typeof amount === "string" && amount.trim() === "" ? null : amount,
    };
    if (entry.key || entry.memberId || entry.name || entry.shares || entry.amount !== null) rows.push(entry);
  });
  if (rows.length === 0) throw new TemplateError("noRows");
  if (rows.length > MAX_TEMPLATE_ROWS) throw new TemplateError("tooManyRows");

  return { tenantId: cellText(meta.getCell("B3").value), originals, rows };
}

type ParsedAmount =
  | { kind: "skip" }
  | { kind: "ok"; cents: number }
  | { kind: "error"; code: "invalidAmount" | "tooLarge" };

// Manual-entry rules; text must be plain digits because "1,500" is locale-ambiguous.
function parseAmount(value: string | number | null): ParsedAmount {
  if (value === null) return { kind: "skip" };
  let input: string | number = value;
  if (typeof value === "string") {
    const text = normalizeBanglaDigits(value).trim();
    if (text === "") return { kind: "skip" };
    if (!AMOUNT_TEXT.test(text)) return { kind: "error", code: "invalidAmount" };
    input = text;
  }
  if (Number(input) === 0) return { kind: "skip" };
  try {
    return { kind: "ok", cents: parsePositiveAmount(input) };
  } catch (error) {
    const tooLarge = error instanceof MoneyError && error.code === "AMOUNT_TOO_LARGE";
    return { kind: "error", code: tooLarge ? "tooLarge" : "invalidAmount" };
  }
}

// Rows without an amount are skipped before any other check: they are not being submitted.
export function reviewDepositImport(
  data: TemplateData,
  ctx: { tenantId: string | null; members: LiveMember[]; alreadyPaid: ReadonlySet<string> },
): ImportReview {
  if (data.tenantId !== (ctx.tenantId ?? "")) throw new TemplateError("wrongTenant");

  const live = new Map(ctx.members.map((m) => [m.id, m]));
  const entries = data.rows.map((r) => ({ r, amount: parseAmount(r.amount) }));
  const keyCounts = new Map<string, number>();
  for (const { r, amount } of entries) {
    if (r.key && amount.kind !== "skip") keyCounts.set(r.key, (keyCounts.get(r.key) ?? 0) + 1);
  }

  const review: ImportReview = { ready: [], flagged: [], skipped: 0, totalCents: 0 };
  for (const { r, amount } of entries) {
    if (amount.kind === "skip") {
      review.skipped += 1;
      continue;
    }
    const original = r.key ? data.originals.get(r.key) : undefined;
    const shown = original ?? r;
    const base: ReviewRow = {
      row: r.row,
      memberId: shown.memberId,
      name: shown.name,
      shares: shown.shares,
      amountCents: amount.kind === "ok" ? amount.cents : null,
    };
    if (!r.key || !original) {
      review.flagged.push({ ...base, reasons: [{ code: "notInTemplate" }] });
      continue;
    }

    const reasons: FlagReason[] = [];
    // Both copies are held back: there is no way to know which amount is right.
    if ((keyCounts.get(r.key) ?? 0) > 1) reasons.push({ code: "duplicate" });
    const fields = FIELDS.filter((f) => r[f] !== original[f]).map((f) => ({
      field: f,
      from: original[f],
      to: r[f],
    }));
    if (fields.length > 0) reasons.push({ code: "changed", fields });
    const member = live.get(r.key);
    if (!member) {
      reasons.push({ code: "missing" });
    } else {
      if (member.status !== "active") reasons.push({ code: "inactive" });
      if (
        member.memberId.trim() !== original.memberId ||
        member.name.trim() !== original.name ||
        String(member.shares ?? 0) !== original.shares
      ) {
        reasons.push({ code: "stale" });
      }
    }
    if (amount.kind === "error") reasons.push({ code: amount.code });
    if (ctx.alreadyPaid.has(r.key)) reasons.push({ code: "alreadyPaid" });

    if (reasons.length === 0 && amount.kind === "ok") {
      review.ready.push({ ...base, key: r.key, amountCents: amount.cents });
      review.totalCents += amount.cents;
    } else {
      review.flagged.push({ ...base, reasons });
    }
  }
  return review;
}
