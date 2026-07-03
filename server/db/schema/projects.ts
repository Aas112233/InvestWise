import { pgTable, uuid, varchar, text, integer, decimal, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { members } from './members.js';

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 255 }).notNull(),
  description: text('description').notNull(),
  initialInvestment: decimal('initial_investment', { precision: 15, scale: 2 }).notNull().default('0'),
  budget: decimal('budget', { precision: 15, scale: 2 }).notNull().default('0'),
  expectedRoi: decimal('expected_roi', { precision: 5, scale: 2 }).default('0'),
  totalShares: integer('total_shares').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull().default('In Progress'),
  health: varchar('health', { length: 50 }).notNull().default('Stable'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  completionDate: timestamp('completion_date', { withTimezone: true }),
  totalEarnings: decimal('total_earnings', { precision: 15, scale: 2 }).default('0'),
  totalExpenses: decimal('total_expenses', { precision: 15, scale: 2 }).default('0'),
  projectFundHandler: varchar('project_fund_handler', { length: 255 }),
  linkedFundId: uuid('linked_fund_id'),
  currentFundBalance: decimal('current_fund_balance', { precision: 15, scale: 2 }).default('0'),
  legacyMongoId: varchar('legacy_mongo_id', { length: 24 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_projects_status_created').on(table.status, table.createdAt),
  index('idx_projects_category_status').on(table.category, table.status),
  index('idx_projects_created').on(table.createdAt),
  index('idx_projects_search').using('gin', sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.description}, '') || ' ' || coalesce(${table.category}, ''))`),
]);

export const projectUpdates = pgTable('project_updates', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  date: timestamp('date', { withTimezone: true }).defaultNow(),
  balanceBefore: decimal('balance_before', { precision: 15, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 15, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  sharesInvested: integer('shares_invested').default(0),
  ownershipPercentage: decimal('ownership_percentage', { precision: 5, scale: 2 }).default('0'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.memberId] }),
]);
