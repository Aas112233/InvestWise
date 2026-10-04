import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Fixed-window counters for abuse controls (public signup today).
 *
 * A count-then-insert throttle is racy: a parallel burst all reads the same
 * count and all pass. `consume()` in lib/rate-limit.ts updates this with a
 * single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which Postgres
 * serializes per key, so the ceiling actually holds under concurrency. It is
 * also one statement with no session state, which keeps it safe behind a
 * transaction-mode pooler (advisory locks would not be).
 *
 * Rows are pruned by the daily cron (app/api/cron/subscription-expiry) — an
 * unbounded key space (one row per client IP) must not be allowed to grow
 * forever, or the throttle becomes a self-inflicted denial of service.
 */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  bucketKey: text('bucket_key').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_rate_limit_buckets_updated_at').on(table.updatedAt),
]);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
