import { pgTable, uuid, varchar, text, decimal, boolean, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects.js';

export const funds = pgTable('funds', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).default('OTHER'),
  status: varchar('status', { length: 50 }).default('ACTIVE'),
  currency: varchar('currency', { length: 10 }).default(''),
  linkedProjectId: uuid('linked_project_id').references(() => projects.id),
  accountNumber: varchar('account_number', { length: 255 }).unique(),
  balance: decimal('balance', { precision: 15, scale: 2 }).default('0').notNull(),
  lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
  reconciliationStatus: varchar('reconciliation_status', { length: 50 }).default('PENDING'),
  handlingOfficer: varchar('handling_officer', { length: 255 }),
  description: text('description'),
  isSystemAsset: boolean('is_system_asset').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
