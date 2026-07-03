import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { auditLogs, users } from '../db/schema/index.js';
import { eq, and, or, desc, count, ilike, gte, lte, sql } from 'drizzle-orm';

// @desc Get system audit logs
// @route GET /api/audit
// @access Private (Admin Only)
const getAuditLogs = asyncHandler(async (req, res) => {
  const pageSize = 20;
  const page = Number(req.query.page) || 1;
  const db = getDb();

  const conditions = [];

  if (req.query.action) {
    conditions.push(ilike(auditLogs.action, `%${req.query.action}%`));
  }

  if (req.query.resourceType) {
    conditions.push(eq(auditLogs.resourceType, req.query.resourceType));
  }

  if (req.query.startDate && req.query.endDate) {
    conditions.push(gte(auditLogs.createdAt, new Date(req.query.startDate)));
    conditions.push(lte(auditLogs.createdAt, new Date(req.query.endDate)));
  }

  if (req.query.search) {
    conditions.push(or(
      ilike(auditLogs.userName, `%${req.query.search}%`),
      sql`${auditLogs.details}::text ILIKE ${'%' + req.query.search + '%'}`
    ));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db.select({ count: count() }).from(auditLogs).where(whereClause);
  const total = Number(countResult.count);

  const logs = await db.select().from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(pageSize * (page - 1));

  // Enrich with user info for populated fields
  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
  if (userIds.length > 0) {
    const userRows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(sql`${users.id} = ANY(${userIds})`);
    const userMap = new Map(userRows.map(u => [u.id, u]));
    for (const log of logs) {
      log.user = userMap.get(log.userId) || null;
    }
  }

  res.json({ logs, page, pages: Math.ceil(total / pageSize), total });
});

// @desc Get supported actions/resources for filtering
// @route GET /api/audit/metadata
// @access Private (Admin Only)
const getAuditMetadata = asyncHandler(async (req, res) => {
  const db = getDb();

  const actionRows = await db.select({ action: auditLogs.action }).from(auditLogs);
  const resourceRows = await db.select({ resourceType: auditLogs.resourceType }).from(auditLogs);

  const actions = [...new Set(actionRows.map(r => r.action))];
  const resources = [...new Set(resourceRows.map(r => r.resourceType).filter(Boolean))];

  res.json({ actions, resources });
});

// @desc Get recent notifications (last 2 days)
// @route GET /api/audit/notifications
// @access Private (Admin Only)
const getNotifications = asyncHandler(async (req, res) => {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const db = getDb();

  const [countResult] = await db.select({ count: count() })
    .from(auditLogs)
    .where(and(
      gte(auditLogs.createdAt, twoDaysAgo),
      sql`${auditLogs.action} ~ '^(CREATE|UPDATE|DELETE|ADD|EDIT)'`
    ));

  const notifications = await db.select()
    .from(auditLogs)
    .where(and(
      gte(auditLogs.createdAt, twoDaysAgo),
      sql`${auditLogs.action} ~ '^(CREATE|UPDATE|DELETE|ADD|EDIT)'`
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);

  res.json({ count: Number(countResult.count), notifications });
});

export { getAuditLogs, getAuditMetadata, getNotifications };
