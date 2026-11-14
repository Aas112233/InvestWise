-- 0030_projects_member_percent
-- Per-project override for the 'Project Level Member' category carve-out
-- (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §6): each project may set its own
-- percentage of the member pool for its Project Level Members, because every
-- project is a different kind of deal. NULL = "no override" — the run falls
-- back to the club-wide rule from system_settings.distribution_rules, and
-- with neither set the split stays the historical pure pro-rata.
--
--   * ADDITIVE ONLY. No existing column, row or index is touched; every
--     existing project keeps NULL, so behaviour is byte-identical until an
--     admin sets a value on a project.
--   * The percent SEMANTICS (0 < p <= 100, at most 2dp, Σ against the other
--     configured categories <= 100%) live in lib/distribution-rules.ts — the
--     single owner — not in a CHECK constraint, so the validation the API,
--     the settings UI and the run engine share cannot drift from the DB.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_member_percent" decimal(5,2);

DO $$
DECLARE
  v_total    integer;
  v_override integer;
BEGIN
  SELECT count(*) INTO v_total    FROM "projects";
  SELECT count(*) INTO v_override FROM "projects" WHERE "project_member_percent" IS NOT NULL;

  RAISE NOTICE '0030_projects_member_percent: % project(s), % with a PM percent override (expected 0 on first run)',
    v_total, v_override;
END $$;
