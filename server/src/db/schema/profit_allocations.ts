import { pgTable, uuid, varchar, decimal, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { members } from './members.js';
import { fiscalPeriods } from './fiscal_periods.js';
import { users } from './users.js';

export const profitAllocations = pgTable('profit_allocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  fiscalPeriodId: uuid('fiscal_period_id').references(() => fiscalPeriods.id),
  memberId: uuid('member_id').references(() => members.id).notNull(),
  allocationType: varchar('allocation_type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  sharesAtTime: integer('shares_at_time').notNull(),
  ratePerShare: decimal('rate_per_share', { precision: 15, scale: 6 }).notNull(),
  notes: varchar('notes', { length: 500 }),
  allocatedBy: uuid('allocated_by').references(() => users.id),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_allocation_period').on(table.fiscalPeriodId),
  index('idx_allocation_member').on(table.memberId),
  index('idx_allocation_type').on(table.allocationType),
]);
