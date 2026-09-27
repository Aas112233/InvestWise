/**
 * Pure permission evaluators shared by client UI and tests (no React).
 * Role-based: the user's normalized role (lib/roles.ts) sets the baseline,
 * explicit per-user overrides (WRITE/READ/NONE + MEMBERS/DEPOSITS parent
 * fallback) win for non-admin roles. SuperAdmin/Admin bypass overrides,
 * exactly as the old level>=5/Admin bypass did.
 */

import { normalizeRole, roleBaselineGrant, type Role } from "./roles";

export type PermissionLevel = "READ" | "WRITE";

export interface PermissionUser {
  role?: string;
  permissions?: Record<string, string>;
}

function parentGrant(
  permissions: Record<string, string> | undefined,
  screen: string,
  requiredLevel: PermissionLevel,
): boolean | undefined {
  if (screen === "MEETINGS" || screen === "GOVERNANCE") {
    const parent = permissions?.["MEMBERS"];
    if (parent === "WRITE") return true;
    if (parent === "READ" && requiredLevel === "READ") return true;
    if (parent === "NONE") return false;
  } else if (screen === "TRANSACTIONS") {
    const parent = permissions?.["DEPOSITS"];
    if (parent === "WRITE") return true;
    if (parent === "READ" && requiredLevel === "READ") return true;
    if (parent === "NONE") return false;
  }
  return undefined;
}

export function hasScreenPermission(
  user: PermissionUser | null | undefined,
  screen: string,
  requiredLevel: PermissionLevel = "WRITE",
): boolean {
  if (!user) return false;

  const role: Role = normalizeRole(user.role);
  if (role === "SuperAdmin" || role === "Admin") return true;

  const explicit = user.permissions?.[screen];
  if (explicit === "WRITE") return true;
  if (explicit === "READ" && requiredLevel === "READ") return true;
  if (explicit === "NONE") return false;

  if (!explicit) {
    const inherited = parentGrant(user.permissions, screen, requiredLevel);
    if (inherited !== undefined) return inherited;
  }

  const baseline = roleBaselineGrant(role, screen);
  if (baseline === "WRITE") return true;
  if (baseline === "READ") return requiredLevel === "READ";
  return false;
}

export function hasAnyScreenPermission(
  user: PermissionUser | null | undefined,
  screens: string[],
  requiredLevel: PermissionLevel = "WRITE",
): boolean {
  return screens.some((s) => hasScreenPermission(user, s, requiredLevel));
}
