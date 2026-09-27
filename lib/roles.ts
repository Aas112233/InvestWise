/**
 * Canonical role model (RBAC). Numeric access levels 1-5 are removed: every
 * authorization decision derives from the user's normalized role plus explicit
 * per-user permission overrides (evaluated in lib/permissions.ts).
 *
 * Canonical roles: SuperAdmin (platform only, null tenant), Admin (tenant
 * org-admin), Manager, Auditor (read-only), Member (standard baseline).
 * Legacy role strings normalize via LEGACY_ROLE_MAP; unknown → Member.
 */

export const ROLES = ["SuperAdmin", "Admin", "Manager", "Auditor", "Member"] as const;
export type Role = (typeof ROLES)[number];

const LEGACY_ROLE_MAP: Record<string, Role> = {
  superadmin: "SuperAdmin",
  "super admin": "SuperAdmin",
  admin: "Admin",
  administrator: "Admin",
  manager: "Manager",
  cashier: "Manager",
  officer: "Manager",
  audit: "Auditor",
  auditor: "Auditor",
  member: "Member",
  "founding member": "Member",
  "normal shareholder": "Member",
  shareholder: "Member",
  investor: "Member",
  "associate member": "Member",
  viewer: "Member",
  guest: "Member",
};

export function normalizeRole(role: unknown): Role {
  if (typeof role !== "string") return "Member";
  const key = role.trim().toLowerCase();
  for (const r of ROLES) {
    if (r.toLowerCase() === key) return r;
  }
  return LEGACY_ROLE_MAP[key] ?? "Member";
}

export function isSuperAdminRole(role: unknown): boolean {
  return normalizeRole(role) === "SuperAdmin";
}

export type BaselineGrant = "WRITE" | "READ" | "NONE";

// Screens a standard Member may read (old level-2 set, preserved exactly).
const MEMBER_READ_SCREENS: ReadonlySet<string> = new Set([
  "DASHBOARD",
  "DEPOSITS",
  "PROJECT_MANAGEMENT",
  "ANALYSIS",
  "REPORTS",
  "GOALS",
  "TRANSACTIONS",
]);

// Baseline grant for a role BEFORE explicit per-user overrides.
// SuperAdmin/Admin: full write. Manager: write everything except SETTINGS
// (not even read — old level-4 rule, preserved). Auditor: read-only.
// Member: level-2 read set + REQUEST_DEPOSIT write.
export function roleBaselineGrant(role: Role, screen: string): BaselineGrant {
  if (role === "SuperAdmin" || role === "Admin") return "WRITE";
  if (role === "Manager") return screen === "SETTINGS" ? "NONE" : "WRITE";
  if (role === "Auditor") return "READ";
  if (screen === "REQUEST_DEPOSIT") return "WRITE";
  return MEMBER_READ_SCREENS.has(screen) ? "READ" : "NONE";
}
