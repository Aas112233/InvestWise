/**
 * §12 idempotency: client-generated retry key for money mutations. The modal
 * generates one per open, so retries of the same logical submission reuse it
 * and the server's reference dup-check rejects a double post.
 *
 * The value is ALSO written to `transactions.reference_number`, which is
 * user-facing (Transactions, Expenses, project timeline, dashboard recents).
 * A bare `crypto.randomUUID()` therefore leaked raw UUIDs into the ledger
 * wherever the client sent it and the server's `referenceNumber || generated`
 * fallback never fired. Always stamp a human-readable prefix.
 */
export type IdempotencyPrefix =
  | "PRJ-EXP"
  | "PRJ-REV"
  | "PRJ-RET"
  | "DEP"
  | "EXP";

export function newIdempotencyRef(prefix?: IdempotencyPrefix): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  if (!prefix) return id;

  // Same shape the server generates for project postings (date + short token),
  // so a client-supplied ref is indistinguishable from a server one.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${stamp}-${id.slice(0, 8).toUpperCase()}`;
}
