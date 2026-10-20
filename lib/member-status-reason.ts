/**
 * Client-safe map from a member's stored status reason to its i18n key.
 *
 * Pure: no DB, no React, no server schema — so the members directory and the
 * detail sheet can both label an inactive member's cause without pulling the
 * Drizzle schema into the client bundle. The reason vocabulary itself lives in
 * lib/governance/status-rules.ts (MEMBER_STATUS_REASON); this is only the
 * presentation binding.
 */
export const MEMBER_STATUS_REASON_KEYS: Record<string, string> = {
  DEPOSIT_NON_COMPLIANCE: "members.statusReasons.depositNonCompliance",
  EQUITY_TRANSFERRED_OUT: "members.statusReasons.equityTransferredOut",
  ADMIN_MANUAL: "members.statusReasons.adminManual",
};

/** i18n key for a reason code, or null when there is no reason to show. */
export function memberStatusReasonKey(reason?: string | null): string | null {
  if (!reason) return null;
  return MEMBER_STATUS_REASON_KEYS[reason] ?? null;
}