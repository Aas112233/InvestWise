/**
 * Canonical role model (RBAC) — server-local mirror of lib/roles.ts 1:1.
 * Lives here (instead of importing @/lib) because server tsconfig rootDir
 * is src/, so files outside src/ break `tsc`. Keep the two in sync:
 * canonical roles, legacy map, and baseline grants must match exactly.
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

const MEMBER_READ_SCREENS: ReadonlySet<string> = new Set([
  "DASHBOARD",
  "DEPOSITS",
  "PROJECT_MANAGEMENT",
  "ANALYSIS",
  "REPORTS",
  "GOALS",
  "TRANSACTIONS",
]);

export function roleBaselineGrant(role: Role, screen: string): BaselineGrant {
  if (role === "SuperAdmin" || role === "Admin") return "WRITE";
  if (role === "Manager") return screen === "SETTINGS" ? "NONE" : "WRITE";
  if (role === "Auditor") return "READ";
  if (screen === "REQUEST_DEPOSIT") return "WRITE";
  return MEMBER_READ_SCREENS.has(screen) ? "READ" : "NONE";
}

/** Env-allowlist platform check (mirrors lib/platform-owner.ts). */
export function isPlatformOwnerEmail(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  const raw = [
    ...(process.env.SUPERADMIN_EMAILS || "").split(","),
    process.env.SUPERADMIN_EMAIL || "",
  ];
  return raw.map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}
