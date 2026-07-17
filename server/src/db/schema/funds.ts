import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const funds = pgTable('funds', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).default('OTHER'),
  status: varchar('status', { length: 50 }).default('ACTIVE'),
  currency: varchar('currency', { length: 10 }).default(''),
  linkedProjectId: uuid('linked_project_id'),
  accountNumber: varchar('account_number', { length: 255 }).unique(),
  balance: decimal('balance', { precision: 15, scale: 2 }).default('0').notNull(),
  lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
  reconciliationStatus: varchar('reconciliation_status', { length: 50 }).default('PENDING'),
  handlingOfficer: varchar('handling_officer', { length: 255 }),
  description: text('description'),
  isSystemAsset: boolean('is_system_asset').default(false),
  minimumBalance: decimal('minimum_balance', { precision: 15, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_funds_type_status').on(table.type, table.status),
  index('idx_funds_linked_project').on(table.linkedProjectId),
  index('idx_funds_type').on(table.type),
]);
