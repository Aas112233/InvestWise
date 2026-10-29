import { pgTable, uuid, varchar, decimal, integer, boolean, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { tenants } from './tenants';

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

// Payment-method jsonb shape (canonical types live in lib/payment-methods.ts;
// duplicated here as a plain default because schema files must not import app
// libs — same pattern as DEFAULT_MEETING_TYPES being mirrored client-side).
const DEFAULT_PAYMENT_METHODS = [
  { name: 'Cash', type: 'CASH' },
  { name: 'Bank Transfer', type: 'BANK' },
  { name: 'bKash', type: 'MOBILE' },
  { name: 'Nagad', type: 'MOBILE' },
  { name: 'Rocket', type: 'MOBILE' },
  { name: 'Check', type: 'CHECK' },
  { name: 'Other', type: 'OTHER' },
];

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  // One row per tenant (AGENTS.md §multi-tenancy).
  tenantId: uuid('tenant_id').references(() => tenants.id),

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
  theme: varchar('theme', { length: 50 }).default('Light'),
  dateFormat: varchar('date_format', { length: 50 }).default('DD/MM/YYYY'),
  /**
   * IANA zone of the tenant's books (default matches the platform default).
   * Business-day filters and month attribution are evaluated on this wall
   * clock, not the server's or the viewer's (lib/tenant-time.ts).
   */
  timezone: varchar('timezone', { length: 60 }).default('Asia/Dhaka').notNull(),
  isMaintenanceMode: boolean('is_maintenance_mode').default(false),

  // Governance & Meeting configuration
  monthlyMeetingDay: integer('monthly_meeting_day').default(5),
  depositDueDate: integer('deposit_due_date').default(10),
  gracePeriodDays: integer('grace_period_days').default(3),
  /**
   * Month-granularity tolerance for submitting a PAST period's deposit.
   * Distinct from `gracePeriodDays`, which is the day-level buffer on the
   * current period's deadline. With 1, a January deposit still counts as
   * on-time if it lands any time in February.
   */
  lateDepositGraceMonths: integer('late_deposit_grace_months').default(1),
  /** Months without a deposit before a member is auto-held (status -> inactive). */
  inactiveAfterMonths: integer('inactive_after_months').default(3),
  /**
   * Months without a deposit before a member becomes SUSPENSION-ELIGIBLE.
   * Suspension is never automatic — the sweep only marks eligibility and an
   * admin confirms. Must be > inactiveAfterMonths.
   */
  suspendedAfterMonths: integer('suspended_after_months').default(6),
  /**
   * Deposit schedule for this tenant: 'monthly' (default) or 'flexible'.
   *
   * 'monthly' is the historical, enforced behaviour — one deposit per member per month,
   * a period obligation, compliance and performance scoring.
   * 'flexible' removes the per-month lock and the obligation. It does NOT remove
   * `transactions.deposit_month`, which is still written on every deposit so reports and
   * the analytics fiscal series keep working.
   *
   * Resolved through `lib/deposit-schedule/schedule.ts` — never read directly, so the
   * duplicate guard, sweep, scoring, leaderboard and matrix cannot disagree.
   * NULL/unrecognised fails closed to 'monthly'. Applied by migration 0025.
   */
  depositSchedule: varchar('deposit_schedule', { length: 20 }).default('monthly'),
  /** Set only when the tenant switches schedule. Audit + flexible-path reference point. */
  depositScheduleChangedAt: timestamp('deposit_schedule_changed_at', { withTimezone: true }),
  /**
   * R1 near-duplicate advisory window in DAYS. A deposit matching an earlier one for
   * the same member on the same amount within this window raises a NON-BLOCKING
   * warning and an audit entry. `0` disables it.
   *
   * This replaces the error ceiling the one-deposit-per-month lock used to provide by
   * accident. It is advisory on purpose: blocking would rebuild the restriction the
   * flexible schedule exists to remove.
   */
  depositNearDuplicateWindowDays: integer('deposit_near_duplicate_window_days').default(3),
  /**
   * R2: above this amount, a FLEXIBLE deposit is filed as a pending request for a
   * second officer rather than posted as settled money. NULL disables it; 0 routes
   * every flexible deposit through approval.
   *
   * Never applied to a monthly tenant — the month lock already bounds the damage
   * there, and changing how monthly deposits post would break the guarantee that
   * monthly behaviour is untouched.
   */
  depositFlexApprovalAbove: decimal('deposit_flex_approval_above', { precision: 15, scale: 2 }),
  meetingTypes: jsonb('meeting_types').$type<string[]>().default(DEFAULT_MEETING_TYPES),
  penaltyRules: jsonb('penalty_rules').$type<PenaltyRuleConfig[]>().default(DEFAULT_PENALTY_RULES),
  /** Tenant-configurable payment methods for deposit forms: name + channel type. */
  paymentMethods: jsonb('payment_methods').$type<{ name: string; type: string }[]>().default(DEFAULT_PAYMENT_METHODS),

  lastUpdatedBy: uuid('last_updated_by').references(() => users.id),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_system_settings_tenant').on(table.tenantId),
  unique('uq_system_settings_tenant').on(table.tenantId),
]);