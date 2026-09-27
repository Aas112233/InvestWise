import { pgTable, uuid, varchar, decimal, integer, boolean, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from './tenants.js';

// Lean billing model: plans, one subscription row per tenant, append-only change log.
// No payment-provider integration — status transitions are platform-driven.
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  priceMonthly: decimal('price_monthly', { precision: 15, scale: 2 }).default('0'),
  maxUsers: integer('max_users').default(100),
  features: jsonb('features').default({}),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_subscription_plans_slug').on(table.slug),
]);

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;

export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  planId: uuid('plan_id').references(() => subscriptionPlans.id),
  status: varchar('status', { length: 50 }).default('trial').notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('uq_tenant_subscriptions_tenant').on(table.tenantId),
  index('idx_tenant_subscriptions_status').on(table.status),
]);

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;

export const subscriptionChangeLog = pgTable('subscription_change_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorEmail: varchar('actor_email', { length: 255 }),
  action: varchar('action', { length: 100 }).notNull(),
  fromPlanId: uuid('from_plan_id').references(() => subscriptionPlans.id),
  toPlanId: uuid('to_plan_id').references(() => subscriptionPlans.id),
  fromStatus: varchar('from_status', { length: 50 }),
  toStatus: varchar('to_status', { length: 50 }),
  reason: varchar('reason', { length: 500 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_subscription_change_log_tenant').on(table.tenantId, table.createdAt.desc()),
]);

export type SubscriptionChangeLog = typeof subscriptionChangeLog.$inferSelect;
