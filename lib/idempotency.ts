/**
 * §12 idempotency: client-generated retry key for money mutations. The modal
 * generates one per open, so retries of the same logical submission reuse it
 * and the server's reference dup-check rejects a double post.
 */
export function newIdempotencyRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
