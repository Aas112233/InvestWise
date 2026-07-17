import { getDb } from '../../config/database.js';
import { auditLogs, users } from '../../db/schema/index.js';
import { eq, and, gte, lte, count, desc, asc, sql } from 'drizzle-orm';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import type { PaginatedResponse } from '../../shared/types.js';

interface AuditLogQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  action?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

interface AuditMetadata {
  actions: string[];
  resourceTypes: string[];
}

interface Notification {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userName: string | null;
  createdAt: Date;
}

/**
 * Retrieve paginated audit logs with optional filters.
 * Joins the users table for enriched data.
 */
export async function getAuditLogs(query: AuditLogQuery): Promise<PaginatedResponse<Record<string, unknown>>> {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(query as Record<string, string>);

  const conditions: ReturnType<typeof sql>[] = [];

  if (query.action) {
    conditions.push(sql`${auditLogs.action} ILIKE ${'%' + query.action + '%'}`);
  }

  if (query.resourceType) {
    conditions.push(eq(auditLogs.resourceType, query.resourceType));
  }

  if (query.startDate) {
    conditions.push(gte(auditLogs.createdAt, new Date(query.startDate)));
  }

  if (query.endDate) {
    conditions.push(lte(auditLogs.createdAt, new Date(query.endDate)));
  }

  if (query.search) {
    conditions.push(
      sql`(${auditLogs.userName} ILIKE ${'%' + query.search + '%'} OR ${auditLogs.details}::text ILIKE ${'%' + query.search + '%'})`,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderByClause = query.sortOrder === 'asc'
    ? asc(auditLogs.createdAt)
    : desc(auditLogs.createdAt);

  const [totalResult, logs] = await Promise.all([
    db.select({ count: count() }).from(auditLogs).where(whereClause),
    db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: auditLogs.userName,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        status: auditLogs.status,
        createdAt: auditLogs.createdAt,
        updatedAt: auditLogs.updatedAt,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(skip),
  ]);

  return formatPaginatedResponse(logs, page, limit, Number(totalResult[0]?.count ?? 0));
}

/**
 * Get distinct action types and resource types for filter dropdowns.
 */
export async function getAuditMetadata(): Promise<AuditMetadata> {
  const db = getDb();

  const [actionRows, resourceTypeRows] = await Promise.all([
    db.selectDistinct({ action: auditLogs.action }).from(auditLogs),
    db.selectDistinct({ resourceType: auditLogs.resourceType }).from(auditLogs),
  ]);

  return {
    actions: actionRows.map((r) => r.action).filter((a): a is string => a !== null),
    resourceTypes: resourceTypeRows
      .map((r) => r.resourceType)
      .filter((rt): rt is string => rt !== null),
  };
}

/**
 * Fetch recent notifications: audit logs from the last 48 hours
 * whose action matches CREATE|UPDATE|DELETE|ADD|EDIT. Returns at most 20 rows.
 */
export async function getNotifications(): Promise<Notification[]> {
  const db = getDb();
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      userName: auditLogs.userName,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        gte(auditLogs.createdAt, since),
        sql`${auditLogs.action} ~ '^(CREATE|UPDATE|DELETE|ADD|EDIT)'`,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    userName: r.userName,
    createdAt: r.createdAt!,
  }));
}
