import { pgTable, uuid, varchar, decimal, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  year: integer('year').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 50 }).default('OPEN'),
  totalDeposits: decimal('total_deposits', { precision: 15, scale: 2 }).default('0'),
  totalWithdrawals: decimal('total_withdrawals', { precision: 15, scale: 2 }).default('0'),
  totalEarnings: decimal('total_earnings', { precision: 15, scale: 2 }).default('0'),
  totalExpenses: decimal('total_expenses', { precision: 15, scale: 2 }).default('0'),
  netSurplus: decimal('net_surplus', { precision: 15, scale: 2 }).default('0'),
  statutoryReserve: decimal('statutory_reserve', { precision: 15, scale: 2 }).default('0'),
  distributableSurplus: decimal('distributable_surplus', { precision: 15, scale: 2 }).default('0'),
  actualDistributed: decimal('actual_distributed', { precision: 15, scale: 2 }).default('0'),
  retainedEarnings: decimal('retained_earnings', { precision: 15, scale: 2 }).default('0'),
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  notes: varchar('notes', { length: 1000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_fiscal_year').on(table.year),
  index('idx_fiscal_status').on(table.status),
]);
