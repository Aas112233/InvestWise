import { pgTable, integer, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Platform-wide settings, one row (id = 1). Distinct from `system_settings`,
 * which is per-tenant: these values are the DEFAULTS a newly provisioned tenant
 * inherits and the operator-facing identity of the SaaS itself.
 *
 * The `id = 1` singleton is enforced by the CHECK constraint in migration 0003,
 * not just convention — a second row would make "the" platform setting
 * ambiguous.
 */
export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1),
  platformName: varchar('platform_name', { length: 120 }).default('InvestWise').notNull(),
  supportEmail: varchar('support_email', { length: 255 }),
  supportPhone: varchar('support_phone', { length: 40 }),
  /** Trial length handed to a newly onboarded tenant. */
  defaultTrialDays: integer('default_trial_days').default(30).notNull(),
  /** Currency a new tenant starts on. */
  defaultCurrency: varchar('default_currency', { length: 10 }).default('BDT').notNull(),
  defaultTimezone: varchar('default_timezone', { length: 60 }).default('Asia/Dhaka').notNull(),
  /** Self-serve signup. Turning this off must be enforced at the API, not just shown. */
  allowPublicRegistration: boolean('allow_public_registration').default(true).notNull(),
  /** Kills every tenant login at once. Distinct from per-tenant maintenance. */
  globalMaintenanceMode: boolean('global_maintenance_mode').default(false).notNull(),
  maintenanceMessage: varchar('maintenance_message', { length: 500 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
export const PLATFORM_SETTINGS_ID = 1;
