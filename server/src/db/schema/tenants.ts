import { pgTable, uuid, varchar, boolean, integer, timestamp, index } from 'drizzle-orm/pg-core';

// Platform tenants for shared-DB multi-tenancy.
// Every business table carries tenantId -> tenants.id (nullable during
// rollout, backfilled to the 'default' tenant by ensureDefaultTenant).
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  plan: varchar('plan', { length: 50 }).default('standard').notNull(),
  isMaintenanceMode: boolean('is_maintenance_mode').default(false).notNull(),
  maxUsers: integer('max_users').default(100).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_tenants_status').on(table.status),
  index('idx_tenants_slug').on(table.slug),
]);

export type Tenant = typeof tenants.$inferSelect;
export const DEFAULT_TENANT_SLUG = 'default';
