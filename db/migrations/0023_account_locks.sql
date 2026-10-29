-- 0023_account_locks
-- Login lockout becomes stored state instead of a COUNT over `login_attempts`.
--
-- The previous implementation derived the lock by counting rows in the
-- append-only forensic log (`login_attempts`, `success = false`, timestamp
-- within 15 minutes). That had four consequences worth naming, because each one
-- is what this table exists to remove:
--
--   1. Rejecting a request while locked out INSERTED another `success = false`
--      row, and the count did not filter on `failure_reason` — so every retry
--      pushed the unlock time a full window further out. Following the
--      "please try again later" advice extended the lockout indefinitely.
--   2. A successful sign-in recorded `success = true` but never cleared the
--      failures, so four old typos left the account one mistake from locked.
--   3. `locked_until` did not exist anywhere, so the 423 could not carry a
--      Retry-After or tell the user when access returns.
--   4. Counting-then-inserting is not atomic, so a parallel burst could all
--      read the same pre-threshold count and each be admitted.
--
-- This table is the control; `login_attempts` stays exactly as it was and goes
-- back to being only the forensic record. One row per normalized (lowercased)
-- email, keyed by email rather than user_id because login runs before the
-- account is resolved: email is unique PER TENANT since migration 0009, so one
-- address can map to several rows, and it also has to be able to lock an
-- address that matches no user at all.
--
-- Re-runnable: CREATE TABLE / INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "account_locks" (
  "email"           varchar(255)      NOT NULL,
  "failed_attempts" integer           NOT NULL DEFAULT 0,
  "locked_until"    timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "account_locks_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "account_locks_failed_attempts_non_negative" CHECK ("failed_attempts" >= 0)
);

-- Drives the daily prune in lib/account-lock.ts; without it the sweep is a
-- sequential scan of every address that ever mistyped a password.
CREATE INDEX IF NOT EXISTS "idx_account_locks_updated_at"
  ON "account_locks" ("updated_at");

COMMENT ON TABLE "account_locks" IS
  'Login lockout control state, one row per normalized email. Distinct from login_attempts, which is the forensic log and is never consulted for authorization.';
COMMENT ON COLUMN "account_locks"."failed_attempts" IS
  'Consecutive credential failures, reset to zero by a successful sign-in or an admin password reset, and restarted from one if the previous failure is older than the rolling window.';
COMMENT ON COLUMN "account_locks"."locked_until" IS
  'NULL when the address may authenticate. Set to now() + escalating duration once failed_attempts crosses the threshold. A rejection while locked never writes this column, so retrying cannot extend a lockout.';
