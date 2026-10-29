import type { NextRequest } from "next/server";
import { getAuthContext, type AuthenticatedUser } from "@/lib/middleware/auth";
import { AuthError, ForbiddenError } from "@/lib/utils/errors";
import { isPlatformOwnerEmail } from "@/lib/platform-owner";
import { isSuperAdminRole } from "@/lib/roles";

export function requireSuperAdmin(user: AuthenticatedUser): void {
  const role = user.role;
  // Platform-only: SuperAdmin role or env allowlist. Tenant org-admins
  // (role Admin) must NOT pass — they are scoped to their own tenant.
  if (!isSuperAdminRole(role) && !isPlatformOwnerEmail(user.email)) {
    throw new ForbiddenError("SuperAdmin access required");
  }
  // SuperAdmin is platform-only by the role model's own definition: a row
  // that pairs the role with tenant context is config drift (no app path
  // creates one). Fail closed instead of letting platform powers ride on a
  // tenant-scoped identity (audit 07 L-8).
  if (user.tenantId) {
    throw new ForbiddenError("SuperAdmin accounts must not be bound to a tenant");
  }
}

export async function requireAuthUser(request: NextRequest): Promise<AuthenticatedUser> {
  const { user, error } = await getAuthContext(request);
  if (error || !user) {
    throw new AuthError("Authentication required", "UNAUTHORIZED");
  }
  return user;
}
