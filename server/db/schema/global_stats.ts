import { pgTable, uuid, varchar, decimal, integer, timestamp } from 'drizzle-orm/pg-core';

export const globalStats = pgTable('global_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  totalDeposits: decimal('total_deposits', { precision: 15, scale: 2 }).default('0'),
  investedCapital: decimal('invested_capital', { precision: 15, scale: 2 }).default('0'),
  totalMembers: integer('total_members').default(0),
  totalShares: integer('total_shares').default(0),
  yieldIndex: decimal('yield_index', { precision: 10, scale: 2 }).default('0'),
  fundStability: decimal('fund_stability', { precision: 5, scale: 2 }).default('100'),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const globalStatsTrends = pgTable('global_stats_trends', {
  id: uuid('id').defaultRandom().primaryKey(),
  globalStatsId: uuid('global_stats_id').references(() => globalStats.id, { onDelete: 'cascade' }).notNull(),
  month: varchar('month', { length: 50 }).notNull(),
  inflow: decimal('inflow', { precision: 15, scale: 2 }).default('0'),
  outflow: decimal('outflow', { precision: 15, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const globalStatsSectors = pgTable('global_stats_sectors', {
  id: uuid('id').defaultRandom().primaryKey(),
  globalStatsId: uuid('global_stats_id').references(() => globalStats.id, { onDelete: 'cascade' }).notNull(),
  category: varchar('category', { length: 255 }).notNull(),
  value: decimal('value', { precision: 15, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
