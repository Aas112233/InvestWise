/**
 * Shared keystroke / paste guards for numeric <input> fields.
 *
 * A native `type="number"` input still accepts `e`, `E`, `+`, `-`
 * (scientific notation) and lets arbitrary text through on paste; a
 * `type="text" inputMode="decimal"` field accepts anything at all on desktop
 * (inputMode only picks the mobile keyboard). These helpers are the single
 * source of truth for "this field only accepts digits (plus an optional
 * decimal point and, where the range allows it, a leading minus)" and are used
 * by both the shared <Input> and <NumericInput> components.
 *
 * The decimal separator is always `.` — the app renders and parses money with
 * `.` decimals and `,` grouping (Intl bn-BD / hi-IN / ur / en-US), so letting
 * a `,` through as a decimal point would push an unparseable value at the API.
 */
export interface NumericGuardOptions {
  /** Allow a decimal point (`.`). Default true. */
  allowDecimal?: boolean;
  /** Allow a leading minus. Default: derived from `min`. */
  allowNegative?: boolean;
  /** The field's `min` attribute, used to derive `allowNegative`. */
  min?: number | string;
}

const NAV_KEYS = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Enter",
  "Escape",
  "Home",
  "End",
]);

function allowNegativeFor(opts: NumericGuardOptions): boolean {
  if (opts.allowNegative !== undefined) return opts.allowNegative;
  // No `min` (or a negative one) means the field may legitimately go negative.
  return opts.min === undefined || opts.min === "" || Number(opts.min) < 0;
}

/** True when this keystroke would type a character the field must reject. */
export function blocksNumericKey(
  e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    currentTarget: HTMLInputElement;
  },
  opts: NumericGuardOptions = {},
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (NAV_KEYS.has(e.key) || e.key.startsWith("Arrow")) return false;
  if (e.key.length !== 1) return false;
  if (/[0-9]/.test(e.key)) return false;

  if ((opts.allowDecimal ?? true) && e.key === ".") {
    return e.currentTarget.value.includes(".");
  }
  if (allowNegativeFor(opts) && e.key === "-") {
    const value = e.currentTarget.value;
    return value.includes("-") || e.currentTarget.selectionStart !== 0;
  }
  return true;
}

/**
 * Reduce pasted text to a single well-formed number: digits, at most one `.`
 * and, where allowed, a leading minus. Grouping separators are dropped
 * ("1,000.50" -> "1000.50"); a lone trailing comma with 1-2 digits is read as a
 * decimal point ("1000,50" -> "1000.50"); everything else is discarded.
 */
export function sanitizeNumericPaste(
  text: string,
  opts: NumericGuardOptions = {},
): string {
  const allowDecimal = opts.allowDecimal ?? true;
  const allowNegative = allowNegativeFor(opts);

  // 1. Drop characters that can never be part of a number.
  let t = text.replace(/[^0-9.,-]/g, "");

  // 2. Sign: keep at most one leading minus, only when the range allows it.
  const negative = allowNegative && t.startsWith("-");
  t = t.replace(/-/g, "");

  if (!allowDecimal) {
    t = t.replace(/[.,]/g, "");
    return (negative ? "-" : "") + t;
  }

  // 3. Resolve the decimal separator.
  if (!t.includes(".") && t.includes(",")) {
    const parts = t.split(",");
    const last = parts[parts.length - 1] ?? "";
    if (parts.length === 2 && last.length !== 3) {
      t = parts[0] + "." + last;
    }
  }
  t = t.replace(/,/g, "");

  // 4. Keep only the first decimal point.
  const dot = t.indexOf(".");
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");

  return (negative ? "-" : "") + t;
}
