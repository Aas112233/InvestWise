import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { members } from './members.js';
import { projects } from './projects.js';
import { funds } from './funds.js';
import { users } from './users.js';

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description').notNull(),
  category: varchar('category', { length: 100 }),
  referenceNumber: varchar('reference_number', { length: 255 }),
  date: timestamp('date', { withTimezone: true }).defaultNow(),
  status: varchar('status', { length: 50 }).default('Completed'),
  memberId: uuid('member_id').references(() => members.id),
  projectId: uuid('project_id').references(() => projects.id),
  fundId: uuid('fund_id').references(() => funds.id),
  handlingOfficer: varchar('handling_officer', { length: 255 }),
  depositMethod: varchar('deposit_method', { length: 50 }),
  authorizedBy: uuid('authorized_by').references(() => users.id),
  balanceBefore: decimal('balance_before', { precision: 15, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 15, scale: 2 }),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  isDeleted: boolean('is_deleted').default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deletionReason: text('deletion_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_trans_member_type_status_deleted_date').on(
    table.memberId, table.type, table.status, table.isDeleted, table.date.desc(),
  ),
  index('idx_trans_fund_type_status_deleted_date').on(
    table.fundId, table.type, table.status, table.isDeleted, table.date.desc(),
  ),
  index('idx_trans_project_type_status_deleted_date').on(
    table.projectId, table.type, table.status, table.isDeleted, table.date.desc(),
  ),
  index('idx_trans_type_status_deleted_date').on(
    table.type, table.status, table.isDeleted, table.date.desc(),
  ),
  index('idx_trans_member_fund_type_date').on(
    table.memberId, table.fundId, table.type, table.date,
  ),
]);
