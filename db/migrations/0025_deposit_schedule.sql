-- 0025_deposit_schedule
-- Tenant-level deposit schedule: 'monthly' (the historical, enforced behaviour) or
-- 'flexible' (a member may deposit any number of times, with no per-month obligation).
--
-- Design: docs/DEPOSIT_SCHEDULE_DESIGN.md
--
-- Scope is deliberately tiny.
--   * ADDITIVE ONLY. No existing column is altered, no row is updated, no index is
--     created or dropped. The default 'monthly' means every existing tenant keeps the
--     exact behaviour it has today without a data migration.
--   * `deposit_schedule_changed_at` is written ONLY when a tenant switches schedule.
--     It exists so the switch can be audited and so the flexible path has a timestamp
--     to reason about; it is intentionally not backfilled to the migration date, which
--     would fake a schedule change that never happened.
--   * `transactions.deposit_month` is NOT touched. A flexible deposit still records the
--     month it is FOR. Reports and the analytics fiscal-series range-filter on that
--     column, so letting it go NULL would silently drop deposits from reporting
--     (spec §1 — "strip the constraint, keep the dimension").
--
-- Re-runnable: IF NOT EXISTS guarded, same house style as 0005_deposits_two_dates.sql.

ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_schedule" varchar(20) DEFAULT 'monthly';

ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_schedule_changed_at" timestamp with time zone;

-- R1 (spec §8): the one-deposit-per-month lock used to be an accidental ceiling on
-- data-entry error — a fat-fingered repeat could not land in the same month twice.
-- Removing that lock for flexible tenants removes the accident, so a deliberate
-- control replaces it: a near-duplicate (same member, same amount, within N days)
-- raises a NON-BLOCKING warning plus an audit entry. It never rejects, because
-- two identical payments inside a window are legitimate on a flexible schedule.
-- 0 disables the check entirely.
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_near_duplicate_window_days" integer DEFAULT 3;

-- R2 (spec §8): a second, deliberately blunter control for flexible tenants. With no
-- month lock, one fat-fingered amount posts straight into the fund balance and the
-- member's contribution, and unwinding it means a revert that debits both again.
-- Above this amount a FLEXIBLE deposit is filed as a pending request for a second
-- officer to approve instead of being posted as settled money.
--   NULL  = disabled (default; no tenant changes behaviour until they opt in)
--   0     = every flexible deposit requires approval
-- It never applies to a monthly tenant: the month lock already bounds the damage
-- there, and silently changing how monthly deposits post would violate the
-- "monthly is unchanged" guarantee this whole change is built around.
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "deposit_flex_approval_above" decimal(15,2);

DO $$
DECLARE
  v_monthly   integer;
  v_flexible  integer;
  v_nullsched integer;
BEGIN
  SELECT count(*) INTO v_monthly   FROM "system_settings" WHERE "deposit_schedule" = 'monthly';
  SELECT count(*) INTO v_flexible  FROM "system_settings" WHERE "deposit_schedule" = 'flexible';
  -- Rows written before the column existed pick up the DEFAULT only on a later UPDATE,
  -- so a freshly ALTERed table can legitimately report NULLs. Harmless: the application
  -- layer fails closed to 'monthly' for NULL (lib/deposit-schedule/schedule.ts).
  SELECT count(*) INTO v_nullsched FROM "system_settings" WHERE "deposit_schedule" IS NULL;

  RAISE NOTICE '0025_deposit_schedule: schedules -> monthly: %, flexible: %, null(fails closed to monthly): %',
    v_monthly, v_flexible, v_nullsched;
END $$;
