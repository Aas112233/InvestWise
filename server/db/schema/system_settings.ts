import { pgTable, uuid, varchar, decimal, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  fiscalYearStart: varchar('fiscal_year_start', { length: 50 }).default('July'),
  baseCurrency: varchar('base_currency', { length: 10 }).default(''),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('15.0'),
  accountingMethod: varchar('accounting_method', { length: 50 }).default('Cash'),
  shareValueBdt: decimal('share_value_bdt', { precision: 15, scale: 2 }).default('1000'),
  isShareValueLocked: boolean('is_share_value_locked').default(false),
  language: varchar('language', { length: 50 }).default('English'),
  refreshInterval: varchar('refresh_interval', { length: 50 }).default('Real-time'),
  theme: varchar('theme', { length: 50 }).default('System Default'),
  dateFormat: varchar('date_format', { length: 50 }).default('DD/MM/YYYY'),
  isMaintenanceMode: boolean('is_maintenance_mode').default(false),
  lastUpdatedBy: uuid('last_updated_by').references(() => users.id),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
