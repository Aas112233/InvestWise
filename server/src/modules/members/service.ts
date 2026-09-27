import { eq, and, ilike, or, sql, desc, asc, type SQLWrapper } from 'drizzle-orm';
import { getDb } from '../../lib/db.js';
import { members } from '../../db/schema/index.js';
import { getPaginationParams, formatPaginatedResponse } from '../../middleware/api.js';
import { AppError } from '../../shared/errors.js';

/** Member directory — paginated list with contributed totals + masking. */

const SORTABLE_COLUMNS: Record<string, unknown> = {
  name: members.name,
  memberId: members.memberId,
  email: members.email,
  shares: members.shares,
  totalContributed: members.totalContributed,
  status: members.status,
  createdAt: members.createdAt,
};

const MEMBER_FIELDS = {
  id: members.id,
  memberId: members.memberId,
  name: members.name,
  email: members.email,
  phone: members.phone,
  role: members.role,
  shares: members.shares,
  totalContributed: members.totalContributed,
  status: members.status,
  avatar: members.avatar,
  joinDate: members.joinDate,
  lastDepositMonth: members.lastDepositMonth,
  totalArrears: members.totalArrears,
  hasUserAccess: members.hasUserAccess,
  userId: members.userId,
  createdAt: members.createdAt,
};

export async function listMembers(
  params: { page?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string; status?: string; role?: string },
  userRole?: string,
  userId?: string,
  tenantId?: string | null,
) {
  const db = getDb();
  const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(params as Record<string, string | undefined>, {
    sortBy: 'createdAt',
    sortOrder: 'desc',
    maxLimit: 500, // dropdown feeds fetch up to 500 members
  });

  // Fail-closed tenant scope (AGENTS.md §6). Every business query is
  // tenant-scoped; a missing tenantId is a programming error, never a
  // silent cross-tenant read. Platform operators reach the admin console
  // instead (requireTenant throws 403 before we get here).
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }

  const conditions: (SQLWrapper | undefined)[] = [eq(members.tenantId, tenantId)];

  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(or(ilike(members.name, pattern), ilike(members.email, pattern), ilike(members.memberId, pattern)));
  }
  if (params.status) conditions.push(eq(members.status, params.status));
  if (params.role) conditions.push(eq(members.role, params.role));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn = (SORTABLE_COLUMNS[sortBy] as typeof members.createdAt) ?? members.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const rows = await db
    .select({
      ...MEMBER_FIELDS,
      totalCount: sql<number>`COUNT(*) OVER()`,
      totalDeposits: sql<string>`COALESCE(${members.totalContributed}, '0.00')`,
    })
    .from(members)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(skip);

  const totalCount = rows.length > 0 ? Number(rows[0]?.totalCount ?? 0) : 0;
  const canViewSensitive = userRole === 'Admin' || userRole === 'Manager';

  const data = rows.map(({ totalCount: _totalCount, ...rest }) => {
    const isOwnRecord = userId && rest.userId === userId;
    if (canViewSensitive || isOwnRecord) return rest;
    return { ...rest, phone: undefined, address: undefined };
  });

  return formatPaginatedResponse(data, page, limit, totalCount);
}
