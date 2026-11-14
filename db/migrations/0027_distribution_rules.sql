-- 0027_distribution_rules
-- Tenant-level per-member-category profit/loss distribution rules:
-- jsonb array of { role, percent } — each configured member category takes its
-- percent of the member pool of every returns/dividend leg, and inside the
-- category the money still splits pro-rata by share number.
--
-- Design: docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md
--
--   * ADDITIVE ONLY. No existing column, row or index is touched.
--   * DEFAULT '[]' means every existing tenant keeps the exact pro-rata-by-shares
--     behaviour it has today: no rules = no carve-out. The application layer also
--     fails closed to "no rules" for NULL (lib/distribution-rules.ts), mirroring
--     how deposit_schedule NULL fails closed to 'monthly'.
--   * Shape validation (vocabulary membership, duplicates, 2dp percent, Σ ≤ 100%)
--     lives in lib/distribution-rules.ts — the single owner — not in the DB.
--   * The project-level-member deposit cap (members.deposit_cap) ships as a
--     separate migration with the Project Member phase.
--
-- Re-runnable: IF NOT EXISTS guarded, house style of 0025_deposit_schedule.sql.

ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "distribution_rules" jsonb DEFAULT '[]'::jsonb;

DO $$
DECLARE
  v_total   integer;
  v_unset   integer;
BEGIN
  SELECT count(*) INTO v_total FROM "system_settings";
  -- NULL/unset both mean "no rules configured" and behave as pure pro-rata.
  SELECT count(*) INTO v_unset FROM "system_settings"
    WHERE "distribution_rules" IS NULL OR "distribution_rules" = '[]'::jsonb;

  RAISE NOTICE '0027_distribution_rules: % settings row(s), % with no rules configured (pro-rata behavior)',
    v_total, v_unset;
END $$;
