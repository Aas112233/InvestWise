import { pgTable, uuid, varchar, text, decimal, date, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { tenants } from './tenants';

export const goals = pgTable('goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  targetAmount: decimal('target_amount', { precision: 15, scale: 2 }).notNull(),
  currentAmount: decimal('current_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  /**
   * #48 — where `current_amount` comes from. `Manual` means a user typed it and
   * it is NOT backed by a fund balance; the UI must label it "unverified".
   * `Allocation` is reserved for a future reserve/allocation writer.
   */
  progressSource: varchar('progress_source', { length: 20 }).notNull().default('Manual'),
  deadline: date('deadline'),
  status: varchar('status', { length: 50 }).notNull().default('In Progress'),
  type: varchar('type', { length: 50 }).notNull().default('Other'),
  linkedProjectId: uuid('linked_project_id').references(() => projects.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_goals_tenant').on(table.tenantId),
  index('idx_goals_user_status').on(table.userId, table.status),
  index('idx_goals_status_deadline').on(table.status, table.deadline),
  index('idx_goals_type').on(table.type),
]);