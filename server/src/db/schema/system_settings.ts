import { pgTable, uuid, varchar, decimal, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export interface PenaltyRuleConfig {
  tier: number;
  title: string;
  type: 'VERBAL_WARNING' | 'FUND_DEDUCTION' | 'SUSPENSION';
  deductionAmount?: number;
  isPercentage?: boolean;
}

export const DEFAULT_PENALTY_RULES: PenaltyRuleConfig[] = [
  { tier: 1, title: '1st Offense - Verbal Warning', type: 'VERBAL_WARNING', deductionAmount: 0, isPercentage: false },
  { tier: 2, title: '2nd Offense - Minor Fine', type: 'FUND_DEDUCTION', deductionAmount: 50, isPercentage: false },
  { tier: 3, title: '3rd Offense - Major Fine', type: 'FUND_DEDUCTION', deductionAmount: 200, isPercentage: false },
  { tier: 4, title: '4th Offense - Suspension & Severe Deduction', type: 'SUSPENSION', deductionAmount: 500, isPercentage: false },
];

export const DEFAULT_MEETING_TYPES = ['FOUNDING_MEMBER', 'SHAREHOLDER', 'INVESTOR'];

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Organization / Corporate Identity
  companyName: varchar('company_name', { length: 150 }).default('InvestWise'),
  companyTagline: varchar('company_tagline', { length: 255 }).default('Enterprise Investment Management'),
  companyAddress: varchar('company_address', { length: 255 }).default(''),
  companyEmail: varchar('company_email', { length: 100 }).default(''),
  companyPhone: varchar('company_phone', { length: 50 }).default(''),
  companyWebsite: varchar('company_website', { length: 100 }).default(''),
  companyRegNo: varchar('company_reg_no', { length: 50 }).default(''),

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

  // Governance & Meeting configuration
  monthlyMeetingDay: integer('monthly_meeting_day').default(5),
  depositDueDate: integer('deposit_due_date').default(10),
  gracePeriodDays: integer('grace_period_days').default(3),
  meetingTypes: jsonb('meeting_types').$type<string[]>().default(DEFAULT_MEETING_TYPES),
  penaltyRules: jsonb('penalty_rules').$type<PenaltyRuleConfig[]>().default(DEFAULT_PENALTY_RULES),

  lastUpdatedBy: uuid('last_updated_by').references(() => users.id),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
