import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from './tenants.js';

// Platform-tier audit trail, separate from tenant audit_logs.
// Survives tenant force-delete (no cascade) so platform actions stay provable.
export const superAdminActionLog = pgTable('super_admin_action_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminUserId: uuid('admin_user_id').references(() => users.id),
  adminEmail: varchar('admin_email', { length: 255 }).notNull(),
  actionType: varchar('action_type', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 100 }),
  targetId: varchar('target_id', { length: 255 }),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_super_admin_log_admin').on(table.adminUserId, table.createdAt.desc()),
  index('idx_super_admin_log_tenant').on(table.tenantId, table.createdAt.desc()),
  index('idx_super_admin_log_action').on(table.actionType, table.createdAt.desc()),
]);

export type SuperAdminActionLog = typeof superAdminActionLog.$inferSelect;
