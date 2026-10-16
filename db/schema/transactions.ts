import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { members } from './members';
import { projects } from './projects';
import { funds } from './funds';
import { users } from './users';

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
  // Project Investment legs only: the deposit fund the capital is drawn FROM.
  // Without it the project fund is credited while the deposit fund keeps the
  // same cash, and the treasury double-counts it. Applied by migration 0015.
  sourceFundId: uuid('source_fund_id').references(() => funds.id),
  handlingOfficer: varchar('handling_officer', { length: 255 }),
  depositMethod: varchar('deposit_method', { length: 50 }),
  // Deposit month (YYYY-MM): the month a deposit is FOR, selected explicitly
  // in the deposit form — can differ from the collected date on back-entry.
  // Survives revert→re-approve cycles and feeds member lastDepositMonth.
  // Applied live via instrumentation boot DDL (transferGroupId pattern).
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
  index('idx_trans_date_status').on(
    table.date.desc(), table.status, table.isDeleted,
  ),
  // Tenant-scoped idempotency guard (referenceNumber): the deposits/expenses/
  // dividends POST routes dup-check with a SELECT-then-INSERT pair, which
  // races under concurrent submits — this partial UNIQUE index is the
  // database-level backstop so a race cannot double-credit a fund. Mirrors
  // uq_trans_tenant_reference in db/migrations/0009_ledger_integrity.sql,
  // which also re-keys pre-existing duplicates (-DUP- suffix) before creating
  // the index. Partial: soft-deleted rows never take part in dup-checks.
  uniqueIndex('uq_trans_tenant_reference').on(
    table.tenantId, table.referenceNumber,
  ).where(sql`is_deleted = false AND reference_number is not null`),
  // Deposit month view: GET /api/deposits?depositMonth=YYYY-MM filters on
  // COALESCE(deposit_month, to_char(date …)) — a function expression no index
  // can serve, so it full-scans the tenant ledger. This composite lets the
  // planner scan by (tenant, month) instead when deposit_month is populated.
  index('idx_trans_tenant_deposit_month').on(
    table.tenantId, table.depositMonth, table.date.desc(),
  ),
  // Ledger search box (GET /api/transactions ?search=): contains-match over
  // reference #, description, and the string form of the row id. Requires the
  // pg_trgm extension (CREATE EXTENSION IF NOT EXISTS pg_trgm — applied live
  // via .workbuddy-ai/tmp/add-search-indexes.mjs).
  index('idx_trans_ref_trgm').using('gin', sql`${table.referenceNumber} gin_trgm_ops`),
  index('idx_trans_desc_trgm').using('gin', sql`${table.description} gin_trgm_ops`),
  index('idx_trans_id_text_trgm').using('gin', sql`(${table.id}::text) gin_trgm_ops`),
]);
