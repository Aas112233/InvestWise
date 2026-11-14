-- 0032_project_type
-- Two project types (docs/PROJECT-TYPES_PLAN.md §3):
--
--   club_level     Board Member + Shareholder Member only. Capital by shares,
--                  returns by the Settings category rules — today's engine,
--                  untouched.
--   extra_investor Adds Project Level Member(s). Their contract percentage of
--                  the total budget is funded first; Board + Shareholder fund
--                  the remainder with shares and split the remainder of the
--                  member pool purely by share number (no category rules).
--
-- What this migration adds:
--   1. projects.project_type  — NOT NULL, defaults to 'club_level'. Every
--      existing project is a club project until the backfill below proves
--      otherwise, so no row needs a value at ADD COLUMN time.
--   2. projects CHECK + index — the vocabulary is enforced in the DB as well as
--      in lib/distribution-rules.ts, and the list screen filters on it.
--   3. project_members.pm_capital — the exact cent amount a PM row invested.
--      PMs are funded by contract, not by shares, so shares_invested stays 0 on
--      those rows and this column is the money that actually moved. NULL on
--      every non-PM row.
--      TYPE NOTE: the plan drafted decimal(14,2); AGENTS §12 mandates
--      decimal(15,2) for every money column, and a 14-digit ceiling is not a
--      real constraint here. Implemented as decimal(15,2).
--
-- Backfill (§3 D6), idempotent: a project that already carries a Project Level
-- Member participant, or a stored project_member_percent, IS an extra-investor
-- project by definition — that is the only way the PM carve-out could have been
-- spent. Everything else stays club_level.
--
-- Seeding: an extra-investor project whose percent is blank while its PM rows
-- were relying on the club-wide 'Project Level Member' rule gets that live rule
-- value written down, so the next run does not fail on a value the club already
-- agreed. If the club has no PM rule, the column stays NULL and Save/Settle fail
-- loud demanding one (lib/distribution-rules.ts) rather than inventing a split.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_type" varchar(20) NOT NULL DEFAULT 'club_level';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_project_type_check'
      AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_project_type_check"
      CHECK ("project_type" IN ('club_level', 'extra_investor'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_projects_type" ON "projects" ("tenant_id", "project_type");

ALTER TABLE "project_members" ADD COLUMN IF NOT EXISTS "pm_capital" decimal(15,2);

-- Evidence-based classification. Re-runnable: the WHERE clause only ever moves
-- a project INTO extra_investor when the evidence is present, never out.
UPDATE "projects" p
SET "project_type" = 'extra_investor'
WHERE (
    p."project_member_percent" IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "project_members" pm
      JOIN "members" m ON m."id" = pm."member_id"
      WHERE pm."project_id" = p."id"
        AND m."role" = 'Project Level Member'
    )
  );

-- Seed the contract from the club-wide PM rule. `percent` is stored as jsonb and
-- may be a number or a numeric string; the regex guard keeps a hand-edited value
-- from aborting the migration on a cast, and MAX() collapses a duplicate role
-- entry (the API forbids duplicates, the DB does not).
WITH club_pm AS (
  SELECT
    s."tenant_id",
    max(
      CASE
        WHEN elem ->> 'percent' ~ '^[0-9]+(\.[0-9]+)?$' THEN (elem ->> 'percent')::numeric
        ELSE NULL
      END
    ) AS pm_pct
  FROM "system_settings" s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s."distribution_rules", '[]'::jsonb)) AS elem
  WHERE elem ->> 'role' = 'Project Level Member'
  GROUP BY s."tenant_id"
)
UPDATE "projects" p
SET "project_member_percent" = round(c.pm_pct, 2)
FROM club_pm c
WHERE c."tenant_id" = p."tenant_id"
  AND p."project_type" = 'extra_investor'
  AND p."project_member_percent" IS NULL
  AND c.pm_pct > 0
  AND c.pm_pct <= 100
  AND EXISTS (
    SELECT 1
    FROM "project_members" pm
    JOIN "members" m ON m."id" = pm."member_id"
    WHERE pm."project_id" = p."id"
      AND m."role" = 'Project Level Member'
  );

DO $$
DECLARE
  v_total      integer;
  v_club       integer;
  v_extra      integer;
  v_pm_rows    integer;
  v_pm_capital integer;
  v_gap        integer;
BEGIN
  SELECT count(*) INTO v_total FROM "projects";
  SELECT count(*) INTO v_club  FROM "projects" WHERE "project_type" = 'club_level';
  SELECT count(*) INTO v_extra FROM "projects" WHERE "project_type" = 'extra_investor';
  SELECT count(*) INTO v_pm_rows FROM "project_members" pm
    JOIN "members" m ON m."id" = pm."member_id"
    WHERE m."role" = 'Project Level Member';
  SELECT count(*) INTO v_pm_capital FROM "project_members" WHERE "pm_capital" IS NOT NULL;

  -- Extra-investor projects that still cannot be split: PM rows, no contract.
  SELECT count(*) INTO v_gap FROM "projects" p
    WHERE p."project_type" = 'extra_investor'
      AND p."project_member_percent" IS NULL
      AND EXISTS (
        SELECT 1 FROM "project_members" pm
        JOIN "members" m ON m."id" = pm."member_id"
        WHERE pm."project_id" = p."id" AND m."role" = 'Project Level Member'
      );

  RAISE NOTICE '0032_project_type: % project(s) = % club_level + % extra_investor (expect sum = %), % PM row(s), % row(s) with pm_capital',
    v_total, v_club, v_extra, v_total, v_pm_rows, v_pm_capital;
  RAISE NOTICE '0032_project_type: % extra_investor project(s) still missing a PM contract percent (expect 0 unless the club rule has none)',
    v_gap;
END $$;
