export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  avatar: string | null;
  memberId: string | null;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

// Roles a tenant Admin may assign (SuperAdmin is platform-only — see
// app/api/auth/users/[id]/route.ts).
export const TENANT_ASSIGNABLE_ROLES = ["Admin", "Manager", "Auditor", "Member"] as const;

export type TenantRole = (typeof TENANT_ASSIGNABLE_ROLES)[number];

// Permission-matrix screens, matching ALL_SCREENS in the API. Labels reuse the
// existing localized nav.* keys.
export const PERMISSION_SCREENS = [
  "DASHBOARD", "MEMBERS", "MEETINGS", "GOVERNANCE", "GOALS", "DEPOSITS", "REQUEST_DEPOSIT",
  "TRANSACTIONS", "DIVIDENDS", "EXPENSES", "PROJECT_MANAGEMENT",
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
  EXPENSES: "nav.expenses",
  PROJECT_MANAGEMENT: "nav.projectMgmt",
  FUNDS_MANAGEMENT: "nav.fundsMgmt",
  ANALYSIS: "nav.analysis",
  REPORTS: "nav.reports",
  SETTINGS: "nav.settings",
};

export const PERMISSION_LEVELS = ["WRITE", "READ", "NONE"] as const;
