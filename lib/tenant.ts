import { AppError } from '@/lib/utils/errors';
import { type AuthenticatedUser } from '@/lib/middleware/auth';
import { isSuperAdminRole } from '@/lib/roles';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';

// Fail-closed tenant resolution for business routes (AGENTS.md §6).
// Platform operators (SuperAdmin role / env allowlist) bypass tenant scope
// ONLY in /api/admin — on business routes they get 403 and must use the admin
// console or impersonation. Tenant users without a tenant row are rejected
// (data-integrity fail-closed; post-backfill this should not happen).
export function requireTenant(tenantId: string | null, user: AuthenticatedUser): string {
  if ((isSuperAdminRole(user.role) || isPlatformOwnerEmail(user.email)) && !tenantId) {
    throw new AppError('Platform operators must use /api/admin endpoints', 403, 'PLATFORM_USE_ADMIN_API');
  }
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  return tenantId;
}
