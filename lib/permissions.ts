/**
 * Pure permission evaluators shared by client UI and tests (no React).
 * Role-based: the user's normalized role (lib/roles.ts) sets the baseline,
 * explicit per-user overrides (WRITE/READ/NONE + MEMBERS/DEPOSITS parent
 * fallback) win for non-admin roles. SuperAdmin/Admin bypass overrides,
 * exactly as the old level>=5/Admin bypass did.
 */

import { normalizeRole, roleBaselineGrant, type Role } from "./roles";

export type PermissionLevel = "READ" | "WRITE" | "MANAGE";

/**
 * Ranked grant levels: NONE < READ < WRITE < MANAGE.
 * MANAGE is the top grant — it satisfies READ, WRITE and MANAGE checks
 * (user management, approvals, configuration on that screen).
 * Stored values remain WRITE/READ/NONE compatible: existing WRITE grants
 * keep passing READ/WRITE checks but NOT new MANAGE checks.
 */
const GRANT_RANK: Record<string, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  MANAGE: 3,
};

function grantSatisfies(granted: string | undefined, required: PermissionLevel): boolean {
  if (!granted) return false;
  const grantRank = GRANT_RANK[granted] ?? -1;
  const requiredRank = GRANT_RANK[required] ?? 99;
  if (granted === "NONE") return false;
  return grantRank >= requiredRank;
}

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
    if (parent === "MANAGE") return true;
    if (parent === "WRITE") return requiredLevel !== "MANAGE";
    if (parent === "READ" && requiredLevel === "READ") return true;
    if (parent === "NONE") return false;
  } else if (screen === "TRANSACTIONS") {
    const parent = permissions?.["DEPOSITS"];
    if (parent === "MANAGE") return true;
    if (parent === "WRITE") return requiredLevel !== "MANAGE";
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
  if (explicit !== undefined) {
    return grantSatisfies(explicit, requiredLevel);
  }

  const inherited = parentGrant(user.permissions, screen, requiredLevel);
  if (inherited !== undefined) return inherited;

  const baseline = roleBaselineGrant(role, screen);
  return grantSatisfies(baseline, requiredLevel);
}

export function hasAnyScreenPermission(
  user: PermissionUser | null | undefined,
  screens: string[],
  requiredLevel: PermissionLevel = "WRITE",
): boolean {
  return screens.some((s) => hasScreenPermission(user, s, requiredLevel));
}
