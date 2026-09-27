import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AppError, normalizeError } from '../shared/errors.js';
import { normalizeRole, isSuperAdminRole, roleBaselineGrant, isPlatformOwnerEmail } from '../shared/roles.js';

/**
 * Route kernel for the financial API: session extraction, Zod body/query
 * validation, tenant scoping guards, and the universal error payload
 * `{ success:false, message, code }` (AGENTS.md §11).
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: Record<string, string>;
  memberId: string | null;
  tenantId: string | null;
}

export type PermissionLevel = 'READ' | 'WRITE';

/** Screen permission evaluator — role-based mirror of lib/permissions.ts 1:1. */
export function hasScreenPermission(
  user: Pick<SessionUser, 'role' | 'permissions'> | null | undefined,
  screen: string,
  requiredLevel: PermissionLevel = 'WRITE',
): boolean {
  if (!user) return false;

  const role = normalizeRole(user.role);

  if (role === 'SuperAdmin' || role === 'Admin') return true;

  const explicit = user.permissions?.[screen];
  if (explicit === 'WRITE') return true;
  if (explicit === 'READ' && requiredLevel === 'READ') return true;
  if (explicit === 'NONE') return false;

  if (!explicit) {
    if (screen === 'MEETINGS' || screen === 'GOVERNANCE') {
      const parent = user.permissions?.['MEMBERS'];
      if (parent === 'WRITE') return true;
      if (parent === 'READ' && requiredLevel === 'READ') return true;
      if (parent === 'NONE') return false;
    } else if (screen === 'TRANSACTIONS') {
      const parent = user.permissions?.['DEPOSITS'];
      if (parent === 'WRITE') return true;
      if (parent === 'READ' && requiredLevel === 'READ') return true;
      if (parent === 'NONE') return false;
    }
  }

  const baseline = roleBaselineGrant(role, screen);
  if (baseline === 'WRITE') return true;
  if (baseline === 'READ') return requiredLevel === 'READ';

  return false;
}

export function hasAnyScreenPermission(
  user: Pick<SessionUser, 'role' | 'permissions'> | null | undefined,
  screens: string[],
  requiredLevel: PermissionLevel = 'WRITE',
): boolean {
  return screens.some((s) => hasScreenPermission(user, s, requiredLevel));
}

export function errorResponse(err: unknown): NextResponse {
  const appErr = normalizeError(err);
  return NextResponse.json(
    {
      success: false,
      message: appErr.statusCode >= 500 ? 'An unexpected error occurred' : appErr.message,
      code: appErr.code,
    },
    { status: appErr.statusCode },
  );
}

export function jsonError(message: string, statusCode: number, code: string): NextResponse {
  return NextResponse.json({ success: false, message, code }, { status: statusCode });
}

/** Validate a request body against a Zod schema; field errors per §11 format. */
export async function validateBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('Request body must be valid JSON', 400, 'INVALID_JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path?.length ? first.path.join('.') : 'body';
    throw new AppError(
      `[Field '${field}', Code: ${first?.code ?? 'VALIDATION'}] ${first?.message ?? 'Invalid input'}`,
      400,
      'VALIDATION_ERROR',
      result.error.issues,
    );
  }
  return result.data;
}

/** Validate URL search params against a Zod schema of strings. */
export function validateQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (value !== '') raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path?.length ? first.path.join('.') : 'query';
    throw new AppError(
      `[Field '${field}', Code: ${first?.code ?? 'VALIDATION'}] ${first?.message ?? 'Invalid input'}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return result.data;
}

/** Authenticated session or 401. */
export async function requireSession(): Promise<SessionUser> {
  const { getSessionUser } = await import('../lib/session.js');
  const user = await getSessionUser();
  if (!user) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  return user;
}

/** Authenticated session with screen permission or 401/403. */
export async function requirePermission(
  screen: string,
  level: PermissionLevel = 'WRITE',
): Promise<SessionUser> {
  const user = await requireSession();
  if (!hasScreenPermission(user, screen, level)) {
    throw new AppError(
      `${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screen}`,
      403,
      'FORBIDDEN',
    );
  }
  return user;
}

/** Any-of screen permission guard. */
export async function requireAnyPermission(
  screens: string[],
  level: PermissionLevel = 'WRITE',
): Promise<SessionUser> {
  const user = await requireSession();
  if (!hasAnyScreenPermission(user, screens, level)) {
    throw new AppError(
      `${level === 'WRITE' ? 'Write' : 'Read'} permission required for: ${screens.join(' or ')}`,
      403,
      'FORBIDDEN',
    );
  }
  return user;
}

/**
 * Deposit-desk guard: Pending requests need REQUEST_DEPOSIT or DEPOSITS
 * write; completed deposits strictly need DEPOSITS write.
 */
export async function requireDepositWritePermission(status?: string): Promise<SessionUser> {
  const user = await requireSession();
  const isPendingRequest = String(status || '').toLowerCase() === 'pending';
  const allowed = isPendingRequest
    ? hasAnyScreenPermission(user, ['REQUEST_DEPOSIT', 'DEPOSITS'], 'WRITE')
    : hasScreenPermission(user, 'DEPOSITS', 'WRITE');
  if (!allowed) {
    throw new AppError(
      isPendingRequest
        ? 'Write permission required for: REQUEST_DEPOSIT or DEPOSITS'
        : 'Write permission required for: DEPOSITS',
      403,
      'FORBIDDEN',
    );
  }
  return user;
}

/** UUID validator for path params (rejects cross-tenant id probing early). */
export function assertUuid(value: string | undefined, field = 'id'): string {
  if (!value || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new AppError(`Invalid ${field} identifier`, 400, 'INVALID_ID');
  }
  return value;
}

/** Pagination params shared by every list endpoint. */
export function getPaginationParams(
  query: Record<string, string | undefined>,
  defaults?: { page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; maxLimit?: number },
): { page: number; limit: number; skip: number; sortBy: string; sortOrder: 'asc' | 'desc' } {
  const page = Math.max(1, Number.parseInt(query.page || '', 10) || defaults?.page || 1);
  // Default ceiling 100 for table endpoints. Dropdown feeds legitimately need
  // more rows and pass a higher maxLimit (mirroring their Zod schema cap).
  const maxLimit = Math.max(1, defaults?.maxLimit ?? 100);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit || '', 10) || defaults?.limit || 20));
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy || defaults?.sortBy || 'createdAt';
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : defaults?.sortOrder || 'desc';
  return { page, limit, skip, sortBy, sortOrder };
}

export function formatPaginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  totalCount: number,
): {
  data: T[];
  meta: { total: number; page: number; limit: number; pages: number; hasNext: boolean; hasPrev: boolean; from: number; to: number };
} {
  const pages = Math.ceil(totalCount / limit) || 1;
  const from = data.length > 0 ? (page - 1) * limit + 1 : 0;
  const to = (page - 1) * limit + data.length;
  return {
    data,
    meta: { total: totalCount, page, limit, pages, hasNext: page < pages, hasPrev: page > 1, from, to },
  };
}

/** Tenant scope for every business query — users carry tenantId. */
export function tenantScope(user: SessionUser): string | null {
  return user.tenantId;
}

/**
 * Fail-closed tenant resolution for server-handler business logic.
 * Platform operators (SuperAdmin role / env allowlist) bypass tenant scope
 * ONLY in /api/admin — inside business handlers they get 403. Tenant users
 * without a tenant row are rejected.
 */
export function requireTenant(user: SessionUser): string {
  if ((isSuperAdminRole(user.role) || isPlatformOwnerEmail(user.email)) && !user.tenantId) {
    throw new AppError('Platform operators must use /api/admin endpoints', 403, 'PLATFORM_USE_ADMIN_API');
  }
  if (!user.tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  return user.tenantId;
}
