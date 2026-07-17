import { pgTable, uuid, varchar, decimal, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  fiscalYearStart: varchar('fiscal_year_start', { length: 50 }).default('July'),
  fiscalYearEnd: varchar('fiscal_year_end', { length: 50 }).default('June'),
  baseCurrency: varchar('base_currency', { length: 10 }).default(''),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('15.0'),
  accountingMethod: varchar('accounting_method', { length: 50 }).default('Cash'),
  shareValueBdt: decimal('share_value_bdt', { precision: 15, scale: 2 }).default('1000'),
  isShareValueLocked: boolean('is_share_value_locked').default(false),
  withdrawalLimitPercent: decimal('withdrawal_limit_percent', { precision: 5, scale: 2 }).default('25'),
  withdrawalNoticeDays: integer('withdrawal_notice_days').default(30),
  maxWithdrawalPerRequest: decimal('max_withdrawal_per_request', { precision: 15, scale: 2 }).default('100000'),
  statutoryReservePercent: decimal('statutory_reserve_percent', { precision: 5, scale: 2 }).default('10'),
  lastFiscalCloseDate: timestamp('last_fiscal_close_date', { withTimezone: true }),
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
