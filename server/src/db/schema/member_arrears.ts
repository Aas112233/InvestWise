import { pgTable, uuid, varchar, decimal, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { members } from './members.js';

export const memberArrears = pgTable('member_arrears', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  periodKey: varchar('period_key', { length: 7 }).notNull(),
  requiredAmount: decimal('required_amount', { precision: 15, scale: 2 }).notNull(),
  actualDeposited: decimal('actual_deposited', { precision: 15, scale: 2 }).default('0'),
  shortfall: decimal('shortfall', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).default('OUTSTANDING'),
  waivedBy: uuid('waived_by').references(() => members.id),
  waivedReason: varchar('waived_reason', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_arrears_member_period').on(table.memberId, table.periodKey),
  index('idx_arrears_status').on(table.status),
]);
