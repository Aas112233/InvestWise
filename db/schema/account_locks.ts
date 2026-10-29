import { pgTable, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

/**
 * Login lockout control state — one row per normalized email.
 *
 * Deliberately separate from `login_attempts`, which is the append-only
 * forensic log. Deriving the lock by counting that log is what made retries
 * extend a lockout, let a successful sign-in leave stale failures behind, and
 * made the check a non-atomic read-then-write; see
 * db/migrations/0023_account_locks.sql for the full reasoning.
 *
 * Keyed on email, not user_id: the check runs before the account is resolved.
 * Email is unique per tenant (migration 0009), so one address can map to
 * several users, and an address matching no user must still be lockable.
 */
export const accountLocks = pgTable('account_locks', {
  /** Lowercased, trimmed email — the same value `normalizeEmail` produces. */
  email: varchar('email', { length: 255 }).primaryKey(),
  /** Consecutive credential failures. Reset on success and on admin reset. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /** NULL means free to authenticate. Never written while already locked. */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type AccountLock = typeof accountLocks.$inferSelect;
