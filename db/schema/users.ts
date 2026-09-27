import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  // Canonical RBAC role: SuperAdmin | Admin | Manager | Auditor | Member
  // (normalized by lib/roles.ts; numeric access_level was removed).
  role: varchar('role', { length: 50 }).default('Member'),
  status: varchar('status', { length: 50 }).default('active'),
  permissions: jsonb('permissions').default({}),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  avatar: varchar('avatar'),
  memberId: varchar('member_id', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_users_tenant').on(table.tenantId),
  index('idx_users_role_status').on(table.role, table.status),
  index('idx_users_member_id').on(table.memberId),
  index('idx_users_created_at').on(table.createdAt),
]);