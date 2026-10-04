-- 0004: abuse-control counters for unauthenticated endpoints (public signup).
--
-- Why a table instead of an in-memory map: this app runs on a serverless
-- runtime where each instance has its own memory, so an in-process limiter
-- resets on every cold start and multiplies its ceiling by the instance count.
-- Postgres is the only shared state the app already has.
--
-- Why `INSERT ... ON CONFLICT` at read time (see lib/rate-limit.ts) rather
-- than SELECT-then-INSERT: the latter lets a parallel burst all observe the
-- same count and all be admitted, which is exactly how a throttle is bypassed.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key        text        PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  count             integer     NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Daily prune in app/api/cron/subscription-expiry deletes on this predicate;
-- the key space is one row per client IP, so it must not grow unbounded.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated_at
  ON rate_limit_buckets (updated_at);

COMMENT ON TABLE rate_limit_buckets IS
  'Fixed-window abuse counters. Rows are disposable telemetry, never business data.';
