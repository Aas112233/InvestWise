/**
 * Single definition of "the reference to show a human" for a ledger row.
 *
 * Before migration 0026 every list rendered
 * `row.referenceNumber || row.id.slice(0, 8)`, which put strings like
 * `a3f9c21b` (8 hex characters of a primary key) and
 * `BLK-9f3c1a2b-7d4e-4a1f-9c8b-2e5d7f1a3b9c-001` (an internal bulk-posting
 * idempotency key) on printed member receipts. Neither is resolvable by a
 * member, a treasurer, or anyone on the phone.
 *
 * `docNumber` (`DEP-2026-00042`) is the canonical answer. The fallbacks exist
 * only so a row predating 0026 never shows LESS than it used to:
 *
 *   1. `docNumber`                — every row created or backfilled since 0026.
 *   2. `referenceNumber`          — a pre-0026 row with no tenant. Worth showing
 *                                   because this column also holds the bank or
 *                                   challan number a clerk typed, which is the
 *                                   member's own data rather than an internal key.
 *   3. em dash                    — genuinely nothing to show.
 *
 * The raw primary key is deliberately absent. It must never be a display value
 * again, so do not reintroduce an `id.slice(...)` fallback here.
 */
export function ledgerRef(
  row:
    | {
        docNumber?: string | null;
        referenceNumber?: string | null;
      }
    | null
    | undefined,
  empty = "\u2014",
): string {
  if (!row) return empty;
  const doc = typeof row.docNumber === "string" ? row.docNumber.trim() : "";
  if (doc) return doc;
  const ref = typeof row.referenceNumber === "string" ? row.referenceNumber.trim() : "";
  return ref || empty;
}

/**
 * True when a row carries no reference at all. Views use it to suppress a
 * copy/print affordance rather than printing an em dash onto a receipt.
 */
export function hasLedgerRef(row: {
  docNumber?: string | null;
  referenceNumber?: string | null;
} | null | undefined): boolean {
  return ledgerRef(row, "") !== "";
}
