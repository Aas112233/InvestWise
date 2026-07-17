import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  userName: varchar('user_name', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: varchar('resource_id', { length: 255 }),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  status: varchar('status', { length: 20 }).default('SUCCESS'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_audit_logs_action_resource_created').on(table.action, table.resourceType, table.createdAt.desc()),
  index('idx_audit_logs_created_at').on(table.createdAt.desc()),
  index('idx_audit_logs_user_id').on(table.userId, table.createdAt.desc()),
  index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
]);
