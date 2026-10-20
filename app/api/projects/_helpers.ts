import { NextRequest, NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { getDb } from '@/db/index';
import { funds } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { getAuthContext, type AuthenticatedUser } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

/**
 * §6 tenant business guard: resolve session + tenant or fail closed.
 * Platform operators (null tenant) must use /api/admin, never this surface.
 */
export async function requireProjectContext(
  request: NextRequest,
  { write = false } = {},
): Promise<{ user: AuthenticatedUser; tenantId: string; error?: never } | { error: NextResponse; user?: never; tenantId?: never }> {
  const { user, tenantId, error } = await getAuthContext(request);
  if (error || !user) {
    return { error: error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }) };
  }
  if (!tenantId) {
    return { error: NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 }) };
  }
  // §6/RBAC: the PROJECT_MANAGEMENT screen permission — the SAME evaluator as
  // the sidebar/AppShell gate and the UI action buttons. A role-only check
  // (the old requireManagerOrAdmin) ignored explicit per-user overrides, so a
  // Manager with PROJECT_MANAGEMENT:"NONE" was blocked in the UI yet still
  // wrote projects over the API.
  if (!hasScreenPermission(user, 'PROJECT_MANAGEMENT', write ? 'WRITE' : 'READ')) {
    return {
      error: NextResponse.json(
        { success: false, message: `Insufficient permissions: PROJECT_MANAGEMENT ${write ? 'write' : 'read'} required` },
        { status: 403 },
      ),
    };
  }
  return { user, tenantId };
}

/** §11 field-formatted Zod error message: [Field '<field>', Code: <code>] <message>. */
export function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  const field = issue?.path.join('.') || 'body';
  const code = issue?.code || 'INVALID';
  const message = issue?.message || 'Invalid input';
  return `[Field '${field}', Code: ${code}] ${message}`;
}

/**
 * §6 cross-tenant rejection: a linked fund must belong to the caller's tenant.
 * Throws ForbiddenError on mismatch/absence.
 */
export async function assertFundInTenant(linkedFundId: string | null | undefined, tenantId: string): Promise<void> {
  if (!linkedFundId) return;
  const [fund] = await getDb()
    .select({ id: funds.id })
    .from(funds)
    .where(and(eq(funds.id, linkedFundId), eq(funds.tenantId, tenantId)))
    .limit(1);
  if (!fund) throw new ForbiddenError('Linked fund does not belong to this tenant');
}

export { ValidationError };
