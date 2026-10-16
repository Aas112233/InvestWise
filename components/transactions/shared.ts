import type { StatusTone } from "@/components/ui/status-badge";

// Type/status label localization lives in lib (pure, dependency-free) so the
// server report pipeline can localize the same values — re-exported here to
// keep the existing import paths intact.
export {
  getTransactionTypeLabel,
  getTransactionStatusLabel,
} from "@/lib/transaction-labels";

export function getTransactionStatusTone(status: string | undefined | null): StatusTone {
  const norm = (status || "").toLowerCase();
  if (norm === "completed" || norm === "success" || norm === "verified") return "emerald";
  if (norm === "pending" || norm === "processing") return "amber";
  if (norm === "failed" || norm === "rejected" || norm === "cancelled" || norm === "canceled") return "rose";
  return "slate";
}
