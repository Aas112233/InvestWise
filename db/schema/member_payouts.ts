import { pgTable, uuid, varchar, text, integer, decimal, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { members } from './members';
import { funds } from './funds';
import { users } from './users';
import { transactions } from './transactions';

/**
 * Suspended-member exit settlement (payout) plans.
 *
 * A payout pays a suspended member their FREE BALANCE (deposits + dividends −
 * money already invested in projects) — never shares × share value, because
 * `members.shares` is a fixed onboarding allocation and does not track money
 * held (see lib/shares.ts). Creating a plan RESERVES the whole amount: the
 * member's `total_contributed` drops to what is left, and the plan owns the
 * rest until it is paid or cancelled. No cash moves at creation — each
 * installment moves cash only when an officer presses Pay, because the
 * handover happens outside the app (§12: the ledger row and the fund debit
 * happen together, in one transaction).
 *
 * Money the member still has inside projects cannot be paid from the deposit
 * fund (it would spend other members' cash), so the plan stays open until those
 * projects settle; the settlement credits the member's balance and the balance
 * is reserved as a final top-up installment.
 */
export const PAYOUT_PLAN_STATUS = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export const PAYOUT_INSTALLMENT_STATUS = {
  SCHEDULED: 'SCHEDULED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export const memberPayoutPlans = pgTable('member_payout_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  memberId: uuid('member_id').references(() => members.id).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  // Reserved total (what the member is owed) and what has actually been paid.
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull(),
  paidAmount: decimal('paid_amount', { precision: 15, scale: 2 }).default('0').notNull(),
  // One-time payout = 1 installment; intervalMonths is the gap between phases
  // (1 = monthly, 2 = every two months, ...). Both are frozen at creation so a
  // later settings change cannot silently rewrite an agreed schedule.
  installmentCount: integer('installment_count').default(1).notNull(),
  intervalMonths: integer('interval_months').default(1).notNull(),
  firstDueDate: timestamp('first_due_date', { withTimezone: true }).notNull(),
  // The DEPOSIT-type fund the cash leaves. Recorded, never guessed, so a
  // payout can be reconciled against the same fund it was promised from.
  sourceFundId: uuid('source_fund_id').references(() => funds.id).notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_payout_plans_tenant_status').on(table.tenantId, table.status),
  index('idx_payout_plans_member').on(table.memberId),
  index('idx_payout_plans_created_at').on(table.createdAt.desc()),
  // One open plan per member (§12 idempotency): two active plans would reserve
  // the same balance twice and pay it out twice.
  uniqueIndex('uq_payout_one_open_plan_per_member')
    .on(table.memberId)
    .where(sql`${table.status} = 'ACTIVE'`),
]);

export const memberPayoutInstallments = pgTable('member_payout_installments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  planId: uuid('plan_id').references(() => memberPayoutPlans.id).notNull(),
  // 1-based order within the plan; due dates are generated from it, and Pay
  // only ever releases the lowest unpaid one so phases cannot run ahead.
  sequence: integer('sequence').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('SCHEDULED').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  // The 'Withdrawal' ledger row created when this installment was paid. NULL
  // until paid, so a scheduled phase is never mistakable for money spent.
  transactionId: uuid('transaction_id').references(() => transactions.id),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('uq_payout_installment_sequence').on(table.planId, table.sequence),
  index('idx_payout_installments_tenant_status_due').on(table.tenantId, table.status, table.dueDate),
]);
