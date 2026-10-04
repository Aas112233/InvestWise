-- 0006_governance_status_thresholds
-- Deposit-compliance governance thresholds (per tenant, on system_settings).
--
-- Why these exist: the tenant can now decide what counts as a late deposit and
-- when a member is held or becomes suspension-eligible.
--   deposit_due_date          — existing; last day to submit that month's deposit
--   grace_period_days         — existing; day-level buffer on the deadline
--   late_deposit_grace_months — NEW; how many months after a period a late
--                               deposit still SETTLES that period. 1 means a
--                               January subscription paid on 10 February
--                               settles January rather than leaving it unpaid.
--   inactive_after_months     — NEW; months with no deposit before the member
--                               is auto-held (status 'active' -> 'inactive').
--   suspended_after_months    — NEW; months with no deposit before the member
--                               is suspension-ELIGIBLE. Suspension is never
--                               automatic — it blocks portal login, so an admin
--                               confirms it. See lib/governance/status-service.ts.
--
-- Ordering invariant: suspended_after_months MUST be > inactive_after_months,
-- otherwise a member would be suspension-eligible before ever being held. The
-- API enforces it on the merged row (PUT /api/settings) and the rules engine
-- rejects an inverted pair (normalizeGovernanceRules); this CHECK is the
-- last line of defence.
--
-- Re-runnable: IF NOT EXISTS guarded.

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "late_deposit_grace_months" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "inactive_after_months"     integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "suspended_after_months"    integer DEFAULT 6;

-- Existing rows pick up the column defaults above; make that explicit rather
-- than relying on ADD COLUMN semantics for a table that already has data.
UPDATE "system_settings" SET "late_deposit_grace_months" = 1 WHERE "late_deposit_grace_months" IS NULL;
UPDATE "system_settings" SET "inactive_after_months"     = 3 WHERE "inactive_after_months" IS NULL;
UPDATE "system_settings" SET "suspended_after_months"    = 6 WHERE "suspended_after_months" IS NULL;

ALTER TABLE "system_settings"
  DROP CONSTRAINT IF EXISTS "chk_system_settings_status_thresholds";

ALTER TABLE "system_settings"
  ADD CONSTRAINT "chk_system_settings_status_thresholds" CHECK (
    "late_deposit_grace_months" BETWEEN 0 AND 6
    AND "inactive_after_months"     BETWEEN 1 AND 36
    AND "suspended_after_months"    BETWEEN 2 AND 60
    AND "suspended_after_months"    >  "inactive_after_months"
  );

COMMENT ON COLUMN "system_settings"."late_deposit_grace_months" IS
  'Months after a period during which a late deposit still settles that period.';
COMMENT ON COLUMN "system_settings"."inactive_after_months" IS
  'Months without a deposit before a member is auto-held (active -> inactive).';
COMMENT ON COLUMN "system_settings"."suspended_after_months" IS
  'Months without a deposit before a member is suspension-eligible; an admin confirms.';
