import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { members } from './members.js';
import { projects } from './projects.js';
import { funds } from './funds.js';
import { users } from './users.js';

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  type: varchar('type', { length: 50 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description').notNull(),
  // Expenses module: distinct expense name (besides category/reason).
  // Applied live via .workbuddy-ai/tmp/add-expense-name-column.mjs.
  expenseName: varchar('expense_name', { length: 255 }),
  // Fund transfers: hard link pairing the Transfer Out / Transfer In legs
  // of one transfer (queryable trail). Applied live via
  // .workbuddy-ai/tmp/add-transfer-group.mjs.
  transferGroupId: uuid('transfer_group_id'),
  category: varchar('category', { length: 100 }),
  referenceNumber: varchar('reference_number', { length: 255 }),
  // Collected date: when cash was received by cashier/accountant. Canonical
  // money-movement date — drives ledger ordering, monthly totals,
  // member lastDepositMonth. Allows past dates for back-entry.
  date: timestamp('date', { withTimezone: true }).defaultNow(),
  status: varchar('status', { length: 50 }).default('Completed'),
  memberId: uuid('member_id').references(() => members.id),
  projectId: uuid('project_id').references(() => projects.id),
  fundId: uuid('fund_id').references(() => funds.id),
  handlingOfficer: varchar('handling_officer', { length: 255 }),
  depositMethod: varchar('deposit_method', { length: 50 }),
  // Deposit month (YYYY-MM): the month a deposit is FOR, selected explicitly
  // in the deposit form — can differ from the collected date on back-entry.
  // Applied live via boot DDL (root instrumentation.ts).
  depositMonth: varchar('deposit_month', { length: 7 }),
  authorizedBy: uuid('authorized_by').references(() => users.id),
  balanceBefore: decimal('balance_before', { precision: 15, scale: 2 }),
  balanceAfter: decimal('balance_after', { precision: 15, scale: 2 }),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  isDeleted: boolean('is_deleted').default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deletionReason: text('deletion_reason'),
  // Submission date: when this deposit was recorded in the app. May differ
  // from collected date (e.g. collected 5th, entered 7th). Defaults to now,
  // settable for back-entry.
  submittedDate: timestamp('submitted_date', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_trans_tenant_date').on(
    table.tenantId, table.date.desc(),
  ),
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
  // Covers the 6-month trend query in analytics: WHERE date >= ? AND status IN (...)
  index('idx_trans_date_status').on(
    table.date.desc(), table.status, table.isDeleted,
  ),
  // Tenant-scoped idempotency/dup-check lookups (referenceNumber) in the
  // deposits/expenses/dividends POST routes previously seq-scanned. Partial:
  // every dup-check query filters out soft-deleted rows.
  index('idx_trans_tenant_reference').on(
    table.tenantId, table.referenceNumber,
  ).where(sql`is_deleted = false`),
  // Ledger search box (GET /api/transactions ?search=): contains-match over
  // reference #, description, and the string form of the row id. Requires the
  // pg_trgm extension (CREATE EXTENSION IF NOT EXISTS pg_trgm — applied live
  // via .workbuddy-ai/tmp/add-search-indexes.mjs).
  index('idx_trans_ref_trgm').using('gin', sql`${table.referenceNumber} gin_trgm_ops`),
  index('idx_trans_desc_trgm').using('gin', sql`${table.description} gin_trgm_ops`),
  index('idx_trans_id_text_trgm').using('gin', sql`(${table.id}::text) gin_trgm_ops`),
]);

export type Transaction = typeof transactions.$inferSelect;
