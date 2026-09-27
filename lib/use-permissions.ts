"use client";

import { useMemo } from "react";
import { useAuth } from "./auth-context";
import {
  hasScreenPermission,
  hasAnyScreenPermission,
  type PermissionLevel,
  type PermissionUser,
} from "./permissions";

/**
 * React hook wrapper over the pure evaluators in lib/permissions.ts.
 * `const { can } = usePermissions(); can("DEPOSITS", "WRITE")`
 */
export function usePermissions() {
  const { user } = useAuth();
  return useMemo(
    () => ({
      user,
      can: (screen: string, level: PermissionLevel = "WRITE") =>
        hasScreenPermission(user as PermissionUser | null, screen, level),
      canAny: (screens: string[], level: PermissionLevel = "WRITE") =>
        hasAnyScreenPermission(user as PermissionUser | null, screens, level),
    }),
    [user],
  );
}

export { hasScreenPermission, hasAnyScreenPermission } from "./permissions";
export type { PermissionLevel, PermissionUser } from "./permissions";
export { normalizeRole, isSuperAdminRole, type Role } from "./roles";
