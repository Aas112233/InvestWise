import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, users } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { formatPaginatedResponse } from '@/lib/utils/types';

const MAX_LIMIT = 100;
const SORTABLE: Record<string, PgColumn> = {
  name: users.name,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
  lastLogin: users.lastLogin,
};

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  permissions: users.permissions,
  avatar: users.avatar,
  memberId: users.memberId,
  lastLogin: users.lastLogin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

export function toUserResponse(row: Record<string, unknown>) {
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};

  const role = normalizeRole(row.role);

  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role,
    status: (row.status as string) ?? 'active',
    permissions,
    avatar: (row.avatar as string) ?? null,
    memberId: (row.memberId as string) ?? null,
    // Member-directory identity for the link chip: the uuid claims the live
    // row, memberCode is the stable MEM-XXXX display code.
    memberUuid: (row.memberUuid as string) ?? null,
    memberName: (row.memberName as string) ?? null,
    memberCode: (row.memberCode as string) ?? null,
    lastLogin: row.lastLogin instanceof Date ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user: authUser, tenantId, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    // User directory is visible to Admins, Managers, and platform operators.
    const callerRole = normalizeRole(authUser.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin or Manager access required');
    }

    const db = getDb();
    // §6: a tenant's Admin/Manager sees their own tenant's directory only.
    // Platform operators (no tenant context) retain the full directory.
    const scope = tenantId ? eq(users.tenantId, tenantId) : undefined;

    // Directory screens send page/limit and get the standard paginated
    // envelope; dropdown callers (no params) keep the legacy bare array.
    // Both join the member directory on members.user_id (uuid FK): one
    // tenant-scoped left join, so the link chip renders without N+1. The
    // tenant scoping on the join is required even though the user rows are
    // already scoped — without it a member uuid collision across tenants
    // could surface another org's member name.
    const memberJoin = tenantId
      ? and(eq(members.userId, users.id), eq(members.tenantId, tenantId))
      : eq(members.userId, users.id);
    const DIRECTORY_SELECT = {
      ...USER_SELECT,
      memberUuid: members.id,
      memberName: memberDisplayNameSql,
      memberCode: members.memberId,
    } as const;
    const { searchParams } = new URL(request.url);
    const paginated = searchParams.has('page') || searchParams.has('limit');
    if (!paginated) {
      const rows = await db
        .select(DIRECTORY_SELECT)
        .from(users)
        .leftJoin(members, memberJoin)
        .where(scope)
        .orderBy(desc(users.createdAt));
      return NextResponse.json(rows.map(toUserResponse));
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const search = (searchParams.get('search') || '').trim();
    const status = (searchParams.get('status') || '').trim();
    const role = (searchParams.get('role') || '').trim();
    const sortByRaw = searchParams.get('sortBy') || 'createdAt';
    const sortCol = SORTABLE[sortByRaw] ?? users.createdAt;
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? asc : desc;

    const filters: SQL[] = [];
    if (scope) filters.push(scope);
    if (search) {
      filters.push(or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))!);
    }
    if (status) filters.push(eq(users.status, status));
    if (role) filters.push(eq(users.role, role));
    const where = filters.length ? and(...filters) : undefined;

    const rows = await db
      .select(DIRECTORY_SELECT)
      .from(users)
      .leftJoin(members, memberJoin)
      .where(where)
      .orderBy(sortOrder(sortCol))
      .limit(limit)
      .offset((page - 1) * limit);

    const [totalRow] = await db.select({ count: count() }).from(users).where(where);
    const total = Number(totalRow?.count ?? 0);

    return NextResponse.json(formatPaginatedResponse(rows.map(toUserResponse), page, limit, total));
  } catch (error: any) {
    console.error('[GET USERS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get users', code: 'USERS_FAILED' },
      { status: 500 }
    );
  }
}