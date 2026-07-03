import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { auditLogs, users } from '../db/schema/index.js';
import { eq, and, or, desc, count, ilike, gte, lte, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET /api/audit
// ---------------------------------------------------------------------------
const getAuditLogs = asyncHandler(async (req, res) => {
  const db = getDb();
  const pageSize = 20;
  const page = Number(req.query.page) || 1;

  // Build where clause from query filters
  const conditions: any[] = [];

  if (req.query.action) {
    conditions.push(
      ilike(auditLogs.action, `%${req.query.action}%`),
    );
  }

  if (req.query.resourceType) {
    conditions.push(eq(auditLogs.resourceType, req.query.resourceType as string));
  }

  if (req.query.startDate && req.query.endDate) {
    conditions.push(
      gte(auditLogs.createdAt, new Date(req.query.startDate as string)),
      lte(auditLogs.createdAt, new Date(req.query.endDate as string)),
    );
  }

  if (req.query.search) {
    conditions.push(
      or(
        ilike(auditLogs.userName, `%${req.query.search}%`),
        ilike(
          sql`COALESCE(${auditLogs.details}::text, '')`,
          `%${req.query.search}%`,
        ),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count
  const [{ count: total }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(whereClause);

  // Fetch logs with optional user join for populate-like behaviour
  const logs = await db
    .select({
      id: auditLogs.id,
      user: auditLogs.user,
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
      // Populate user info via join
      userInfo: {
        name: users.name,
        email: users.email,
        role: users.role,
      },
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.user, users.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(pageSize * (page - 1));

  // Flatten: attach user info onto each log entry
  const enrichedLogs = logs.map((log) => ({
    ...log,
    user: log.user
      ? { _id: log.user, name: log.userInfo?.name, email: log.userInfo?.email, role: log.userInfo?.role }
      : null,
    userInfo: undefined, // remove the join helper field
  }));

  res.json({
    logs: enrichedLogs,
    page,
    pages: Math.ceil(Number(total) / pageSize),
    total: Number(total),
  });
});

// ---------------------------------------------------------------------------
// GET /api/audit/metadata
// ---------------------------------------------------------------------------
const getAuditMetadata = asyncHandler(async (req, res) => {
  const db = getDb();

  const actionRows = await db
    .select({ value: auditLogs.action })
    .from(auditLogs)
    .groupBy(auditLogs.action);

  const resourceRows = await db
    .select({ value: auditLogs.resourceType })
    .from(auditLogs)
    .groupBy(auditLogs.resourceType);

  const actions = actionRows
    .map((r) => r.value)
    .filter((v): v is string => v !== null);

  const resources = resourceRows
    .map((r) => r.value)
    .filter((v): v is string => v !== null);

  res.json({ actions, resources });
});

// ---------------------------------------------------------------------------
// GET /api/audit/notifications
// ---------------------------------------------------------------------------
const getNotifications = asyncHandler(async (req, res) => {
  const db = getDb();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const whereClause = and(
    gte(auditLogs.createdAt, twoDaysAgo),
    // Match impactful actions (CREATE, UPDATE, DELETE, ADD, EDIT)
    sql`${auditLogs.action} ~* '^(CREATE|UPDATE|DELETE|ADD|EDIT)'`,
  );

  const [{ count: total }] = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(whereClause);

  const notifications = await db
    .select()
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);

  res.json({
    count: Number(total),
    notifications,
  });
});

export { getAuditLogs, getAuditMetadata, getNotifications };
