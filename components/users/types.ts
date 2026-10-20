export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  avatar: string | null;
  memberId: string | null;
  memberUuid?: string | null;
  memberName?: string | null;
  memberCode?: string | null;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

// Roles a tenant Admin may assign (SuperAdmin is platform-only — see
// app/api/auth/users/[id]/route.ts).
export const TENANT_ASSIGNABLE_ROLES = ["Admin", "Manager", "Auditor", "Member"] as const;

// Permission-matrix screens, matching ALL_SCREENS in the API. Labels reuse the
// existing localized nav.* keys.
export const PERMISSION_SCREENS = [
  "DASHBOARD", "MEMBERS", "MEETINGS", "GOVERNANCE", "GOALS", "DEPOSITS", "REQUEST_DEPOSIT",
  "TRANSACTIONS", "DIVIDENDS", "PAYOUTS", "EXPENSES", "PROJECT_MANAGEMENT",
  "FUNDS_MANAGEMENT", "ANALYSIS", "REPORTS", "SETTINGS",
] as const;

export const SCREEN_LABEL_KEY: Record<string, string> = {
  DASHBOARD: "nav.dashboard",
  MEMBERS: "nav.members",
  MEETINGS: "nav.meetings",
  GOVERNANCE: "nav.governance",
  GOALS: "nav.goals",
  DEPOSITS: "nav.deposits",
  REQUEST_DEPOSIT: "nav.requestDeposit",
  TRANSACTIONS: "nav.transactions",
  DIVIDENDS: "nav.dividends",
  PAYOUTS: "nav.payouts",
  EXPENSES: "nav.expenses",
  PROJECT_MANAGEMENT: "nav.projectMgmt",
  FUNDS_MANAGEMENT: "nav.fundsMgmt",
  ANALYSIS: "nav.analysis",
  REPORTS: "nav.reports",
  SETTINGS: "nav.settings",
};

/**
 * Access presets — one-click templates that fill the per-screen matrix.
 * READ_ONLY: every screen READ (Auditor baseline equivalent, stored explicit).
 * STANDARD_WRITE: operational screens WRITE, sensitive screens READ.
 * FULL_MANAGE: every screen MANAGE (Member role + full grants; Admin role
 * still bypasses everything server-side regardless of stored matrix).
 */
export const ACCESS_PRESETS = {
  READ_ONLY: "READ_ONLY",
  STANDARD_WRITE: "STANDARD_WRITE",
  FULL_MANAGE: "FULL_MANAGE",
} as const;

export type AccessPreset = (typeof ACCESS_PRESETS)[keyof typeof ACCESS_PRESETS];

const SENSITIVE_SCREENS: ReadonlySet<string> = new Set([
  "SETTINGS",
  "FUNDS_MANAGEMENT",
  "DIVIDENDS",
  // Paying a member out is a cash handover, not a report — same sensitivity
  // class as dividends and fund management.
  "PAYOUTS",
  "PROJECT_MANAGEMENT",
]);

export function presetPermissions(preset: AccessPreset): Record<string, string> {
  if (preset === "READ_ONLY") {
    return Object.fromEntries(PERMISSION_SCREENS.map((s) => [s, "READ"]));
  }
  if (preset === "FULL_MANAGE") {
    return Object.fromEntries(PERMISSION_SCREENS.map((s) => [s, "MANAGE"]));
  }
  return Object.fromEntries(
    PERMISSION_SCREENS.map((s) => [s, SENSITIVE_SCREENS.has(s) ? "READ" : "WRITE"]),
  );
}
