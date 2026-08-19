import { pgTable, uuid, varchar, text, integer, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { members } from './members.js';
import { meetings } from './meetings.js';
import { transactions } from './transactions.js';
import { funds } from './funds.js';
import { users } from './users.js';

export const memberPenalties = pgTable('member_penalties', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id').references(() => members.id).notNull(),
  meetingId: uuid('meeting_id').references(() => meetings.id),
  tier: integer('tier').notNull(), // 1, 2, 3, 4
  title: varchar('title', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // VERBAL_WARNING, FUND_DEDUCTION, SUSPENSION
  deductionAmount: decimal('deduction_amount', { precision: 15, scale: 2 }).default('0'),
  isPercentage: boolean('is_percentage').default(false),
  calculatedDeduction: decimal('calculated_deduction', { precision: 15, scale: 2 }).default('0'),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  fundId: uuid('fund_id').references(() => funds.id),
  status: varchar('status', { length: 50 }).default('ACTIVE').notNull(), // ACTIVE, WAIVED, RESOLVED
  reason: text('reason').notNull(),
  issuedBy: uuid('issued_by').references(() => users.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow(),
  waivedBy: uuid('waived_by').references(() => users.id),
  waivedAt: timestamp('waived_at', { withTimezone: true }),
  waiveReason: text('waive_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_penalties_member_status').on(table.memberId, table.status),
  index('idx_penalties_tier').on(table.tier),
  index('idx_penalties_meeting').on(table.meetingId),
  index('idx_penalties_created_at').on(table.createdAt.desc()),
]);
