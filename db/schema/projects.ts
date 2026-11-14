import { pgTable, uuid, varchar, text, integer, decimal, date, timestamp, index, uniqueIndex, primaryKey, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { members } from './members';
import { funds } from './funds';
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  /**
   * Human reference code, PRJ-XXXX per tenant (migration 0031) — the project
   * module's counterpart of member codes. Generated server-side
   * (lib/project-code.ts), immutable once assigned; the UUID stays the key.
   */
  projectCode: varchar('project_code', { length: 20 }),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 255 }).notNull(),
  description: text('description').notNull(),
  initialInvestment: decimal('initial_investment', { precision: 15, scale: 2 }).notNull().default('0'),
  budget: decimal('budget', { precision: 15, scale: 2 }).notNull().default('0'),
  expectedRoi: decimal('expected_roi', { precision: 5, scale: 2 }).default('0'),
  totalShares: integer('total_shares').notNull().default(0),
  status: varchar('status', { length: 50 }).notNull().default('In Progress'),
  health: varchar('health', { length: 50 }).notNull().default('Stable'),
  startDate: date('start_date').notNull(),
  completionDate: date('completion_date'),
  totalEarnings: decimal('total_earnings', { precision: 15, scale: 2 }).default('0'),
  totalExpenses: decimal('total_expenses', { precision: 15, scale: 2 }).default('0'),
  projectFundHandler: varchar('project_fund_handler', { length: 255 }),
  linkedFundId: uuid('linked_fund_id').references(() => funds.id, { onDelete: 'set null' }),
  currentFundBalance: decimal('current_fund_balance', { precision: 15, scale: 2 }).default('0'),
  /** Settled & closed: set true by a "Distribute Complete Project" run. One-way — no code path clears it. */
  isLocked: boolean('is_locked').notNull().default(false),
  /**
   * Per-project override for the 'Project Level Member' category carve-out
   * (migration 0030). NULL = fall back to the club-wide rule in
   * system_settings.distribution_rules. Validation lives in
   * lib/distribution-rules.ts — (0, 100] ≤2dp, Σ ≤ 100% with the other rules.
   */
  projectMemberPercent: decimal('project_member_percent', { precision: 5, scale: 2 }),
  /**
   * Project type (migration 0032, docs/PROJECT-TYPES_PLAN.md):
   * 'club_level' = Board + Shareholder only, returns by the Settings category
   * rules; 'extra_investor' = adds Project Level Members, whose contract
   * percentage is carved from the member pool first and the remainder split
   * purely by share number. Immutable once the project has any transaction.
   * Validated against the CHECK constraint and lib/distribution-rules.ts.
   */
  projectType: varchar('project_type', { length: 20 }).notNull().default('club_level'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_projects_tenant').on(table.tenantId),
  index('idx_projects_status_created').on(table.status, table.createdAt),
  index('idx_projects_category_status').on(table.category, table.status),
  index('idx_projects_created').on(table.createdAt),
  index('idx_projects_linked_fund').on(table.linkedFundId),
  index('idx_projects_type').on(table.tenantId, table.projectType),
  uniqueIndex('projects_tenant_code_key').on(table.tenantId, table.projectCode),
  index('idx_projects_search').using('gin', sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.description}, '') || ' ' || coalesce(${table.category}, ''))`),
]);

export const projectUpdates = pgTable('project_updates', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  date: timestamp('date', { withTimezone: true }).defaultNow(),
  balanceBefore: decimal('balance_before', { precision: 15, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 15, scale: 2 }),
  isDeleted: boolean('is_deleted').notNull().default(false),
  /** Ledger row this posting created — the printable update receipt is keyed on it. 1:1. */
  transactionId: uuid('transaction_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_project_updates_tenant').on(table.tenantId),
  index('idx_project_updates_project').on(table.projectId, table.date.desc()),
  uniqueIndex('idx_project_updates_transaction').on(table.transactionId),
]);

export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }).notNull(),
  sharesInvested: integer('shares_invested').default(0),
  ownershipPercentage: decimal('ownership_percentage', { precision: 5, scale: 2 }).default('0'),
  /**
   * Exact cent amount a Project Level Member row invested (migration 0032).
   * PMs are funded by contract on an Extra Investor project — not by shares —
   * so shares_invested stays 0 on those rows and this is the money that left
   * the member's source fund. NULL on every non-PM row.
   */
  pmCapital: decimal('pm_capital', { precision: 15, scale: 2 }),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.memberId] }),
  index('idx_project_members_member').on(table.memberId),
]);