import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { AppError, normalizeError } from '../shared/errors';
import { normalizeRole, isSuperAdminRole, roleBaselineGrant, isPlatformOwnerEmail } from '../shared/roles';
import { getDb } from '../lib/db';
import { tenants } from '../db/schema/index';
// The repo carries two drizzle-orm installs (root 0.45.x + server 0.38.x).
// Every query in this file runs on the SERVER copy, pairing server/src/lib/db
// with server/src/db/schema. The one column the server schema copy lacks
// (tenants.module_access) is read as a raw jsonb field. Cross-tree helpers
// (maintenance flags, subscription guard, module entitlements) are pure
// async functions — no drizzle objects cross the boundary.
import { getTenantSubscriptionBlocked } from '@/lib/subscription-guard';
import { moduleForApiPath, resolveModuleAccess } from '@/lib/tenant-modules';
import { getMaintenanceFlags } from '@/lib/middleware/auth';

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

export type PermissionLevel = 'READ' | 'WRITE' | 'MANAGE';

/** Ranked grants: NONE < READ < WRITE < MANAGE (mirror of lib/permissions.ts 1:1). */
const GRANT_RANK: Record<string, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  MANAGE: 3,
};

function grantSatisfies(granted: string | undefined, required: PermissionLevel): boolean {
  if (!granted) return false;
  if (granted === 'NONE') return false;
  return (GRANT_RANK[granted] ?? -1) >= (GRANT_RANK[required] ?? 99);
}

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
  if (explicit !== undefined) {
    return grantSatisfies(explicit, requiredLevel);
  }

  if (screen === 'MEETINGS' || screen === 'GOVERNANCE') {
    const parent = user.permissions?.['MEMBERS'];
    if (parent === 'MANAGE') return true;
    if (parent === 'WRITE') return requiredLevel !== 'MANAGE';
    if (parent === 'READ' && requiredLevel === 'READ') return true;
    if (parent === 'NONE') return false;
  } else if (screen === 'TRANSACTIONS') {
    const parent = user.permissions?.['DEPOSITS'];
    if (parent === 'MANAGE') return true;
    if (parent === 'WRITE') return requiredLevel !== 'MANAGE';
    if (parent === 'READ' && requiredLevel === 'READ') return true;
    if (parent === 'NONE') return false;
  }

  const baseline = roleBaselineGrant(role, screen);
  return grantSatisfies(baseline, requiredLevel);
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
  // Intentional AppErrors carry client-safe messages by construction (AGENTS.md
  // §11) — never mask them, including 5xx (e.g. the 503 maintenance gates in
  // requireSession must reach the client verbatim, matching
  // lib/middleware/auth.ts). Unknown failures still normalize to the masked
  // INTERNAL_ERROR payload.
  const message =
    err instanceof AppError
      ? appErr.message
      : appErr.statusCode >= 500
        ? 'An unexpected error occurred'
        : appErr.message;
  return NextResponse.json(
    {
      success: false,
      message,
      code: appErr.code,
    },
    { status: appErr.statusCode },
  );
}

export function jsonError(message: string, statusCode: number, code: string): NextResponse {
  return NextResponse.json({ success: false, message, code }, { status: statusCode });
}

/**
 * Parse a JSON request body that the caller will read field-by-field (rather
 * than hand to a Zod schema). Fails CLOSED with a 400 on malformed JSON or a
 * non-object body — never lets a client error surface as a 500.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('Request body must be valid JSON', 400, 'INVALID_JSON');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('Request body must be a JSON object', 400, 'INVALID_BODY');
  }
  return raw as Record<string, unknown>;
}

/** Validate a request body against a Zod schema; field errors per §11 format. */
export async function validateBody<T>(
  request: Request,
  schema: ZodType<T>,
  options?: { maxBytes?: number; requireJsonContentType?: boolean },
): Promise<T> {
  if (options?.requireJsonContentType) {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new AppError('Content-Type must be application/json', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
  }

  let raw: unknown;
  try {
    if (options?.maxBytes) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > options.maxBytes) {
        throw new AppError('Request body is too large', 413, 'PAYLOAD_TOO_LARGE');
      }
      raw = JSON.parse(text);
    } else {
      raw = await request.json();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
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

const DEFAULT_MAINTENANCE_MESSAGE = 'System is under maintenance. Please try again later.';

/**
 * Request path for module-entitlement gating. Next.js keeps the live request
 * (including url.pathname) in the same async storage that powers cookies()/
 * headers() — requireSession runs inside route handlers, where that store is
 * always present (session.ts already relies on it via cookies()). Returns null
 * only outside a request scope (unit tests), which skips the path-dependent
 * check; every other gate still applies.
 * ponytail: switch to a stable Next public API when one exists.
 */
function currentRequestPathname(): string | null {
  try {
    const store = workUnitAsyncStorage.getStore();
    if (store && store.type === 'request') return store.url.pathname;
  } catch {
    // No request scope — fall through to null.
  }
  return null;
}

/**
 * Authenticated session or 401 — PLUS the tenant-level gates the modern stack
 * (lib/middleware/auth.ts getAuthContext) applies to every non-delegated
 * route, with identical status codes and error codes:
 *   account suspended/inactive -> 401 ACCOUNT_SUSPENDED / ACCOUNT_INACTIVE
 *   global maintenance         -> 503 MAINTENANCE_MODE
 *   tenant maintenance         -> 503 TENANT_MAINTENANCE
 *   tenant suspended           -> 403 TENANT_SUSPENDED
 *   module not licensed        -> 403 MODULE_NOT_LICENSED
 *   subscription inactive      -> 403 SUBSCRIPTION_BLOCKED
 *
 * Every delegated handler (server/src/modules/<module>/handlers.ts and
 * app/api/funds/transfer) funnels through this guard or the permission guards
 * that call it, so the gates hold in one place without touching handlers.
 *
 * Platform operators (null tenant) are intentionally NOT gated here: they fall
 * through to requireTenant in the handler, which confines them to /api/admin
 * (403 PLATFORM_USE_ADMIN_API) — pre-existing behavior, preserved.
 */
export async function requireSession(): Promise<SessionUser> {
  const { getSessionUser } = await import('../lib/session');
  const user = await getSessionUser();
  if (!user) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');

  // Account status gate — codes mirror lib/middleware/auth.ts. session.ts no
  // longer collapses suspended/inactive identities to null so these exact
  // codes reach the client; the check runs per request on the cached identity,
  // so enforcement is immediate.
  if (user.status === 'suspended') throw new AppError('Account is suspended', 401, 'ACCOUNT_SUSPENDED');
  if (user.status === 'inactive') throw new AppError('Account is inactive', 401, 'ACCOUNT_INACTIVE');

  if (user.tenantId) {
    // Fresh PK lookup per request: suspension must apply the moment an
    // operator flips the switch, not up to a cache TTL later. A DB error here
    // propagates (handler catch -> 500): fail closed.
    const db = getDb();
    const [tenant] = await db
      .select({
        status: tenants.status,
        isMaintenanceMode: tenants.isMaintenanceMode,
        // module_access exists in the database (root schema models it) but not
        // in the server schema copy — read the jsonb column raw.
        moduleAccess: sql<unknown>`module_access`,
      })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
      .limit(1);

    // A tenant user without a tenant row is a corrupt state — never let it
    // through the money API (the modern stack skips its gates in this case;
    // here we fail closed instead).
    if (!tenant) throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');

    const isSuperAdmin = isSuperAdminRole(user.role);

    // Maintenance gates. SuperAdmin bypasses both switches so support can
    // always reach a tenant (mirrors lib/middleware/auth.ts). Flags come from
    // the shared per-tenant helper (30s cache, global switch + the CALLER's
    // tenant row — the hardcoded slug='default' lookup is fixed in auth.ts).
    if (!isSuperAdmin) {
      const flags = await getMaintenanceFlags(user.tenantId);
      if (flags.globalMaintenance) {
        throw new AppError(flags.globalMessage || DEFAULT_MAINTENANCE_MESSAGE, 503, 'MAINTENANCE_MODE');
      }
      if (flags.tenantMaintenance || tenant.isMaintenanceMode) {
        throw new AppError('Tenant is in maintenance mode', 503, 'TENANT_MAINTENANCE');
      }
    }

    if (tenant.status === 'suspended') {
      throw new AppError('Tenant is suspended', 403, 'TENANT_SUSPENDED');
    }

    // Module entitlement gate — same route-prefix mapping and merge logic as
    // lib/middleware/auth.ts. A module the tenant is not licensed for is
    // rejected at the API, not merely hidden in the sidebar.
    if (!isSuperAdmin) {
      const pathname = currentRequestPathname();
      const required = pathname ? moduleForApiPath(pathname) : null;
      if (required && resolveModuleAccess(tenant.moduleAccess)[required] === false) {
        throw new AppError(`Module '${required}' is not enabled for this organisation`, 403, 'MODULE_NOT_LICENSED');
      }
    }

    // Subscription gate — shared helper (60s per-tenant cache), checked LAST
    // exactly like getAuthContext. Platform operators (null tenant) skipped.
    if (await getTenantSubscriptionBlocked(user.tenantId)) {
      throw new AppError('Subscription is inactive. Please contact support.', 403, 'SUBSCRIPTION_BLOCKED');
    }
  }

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
      `${level === 'WRITE' ? 'Write' : level === 'MANAGE' ? 'Manage' : 'Read'} permission required for: ${screen}`,
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
      `${level === 'WRITE' ? 'Write' : level === 'MANAGE' ? 'Manage' : 'Read'} permission required for: ${screens.join(' or ')}`,
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

/**
 * Fail-closed tenant resolution for server-handler business logic.
 * Platform operators (SuperAdmin role / env allowlist) bypass tenant scope
 * ONLY in /api/admin — inside business handlers they get 403. Tenant users
 * without a tenant row are rejected.
 */
export function requireTenant(user: SessionUser): string {
  if ((isSuperAdminRole(user.role) || isPlatformOwnerEmail(user.email)) && !user.tenantId) {
    throw new AppError('Platform administration is done in the admin console, not from tenant screens.', 403, 'PLATFORM_USE_ADMIN_API');
  }
  if (!user.tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  return user.tenantId;
}
