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
}

export async function requireAuthUser(request: NextRequest): Promise<AuthenticatedUser> {
  const { user, error } = await getAuthContext(request);
  if (error || !user) {
    throw new AuthError("Authentication required", "UNAUTHORIZED");
  }
  return user;
}
