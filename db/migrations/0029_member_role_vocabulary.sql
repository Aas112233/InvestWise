-- 0029_member_role_vocabulary
-- Six-category member vocabulary (user decision 2026-11-12, "those only"):
--   Admin | Manager | Board Member | Shareholder Member | Project Level Member | Auditor
--
-- * 'Member', 'Investor', 'Associate Member' and 'Founding Member' are folded
--   into 'Shareholder Member' — every one of them was a share-holding club
--   member, which is exactly what category B means (mapping confirmed by the
--   user before this migration shipped).
-- * 'Project Member' is renamed 'Project Level Member'. 0 rows are expected to
--   move (the category ships in the same release), but the UPDATE keeps this
--   correct for any environment that ran the earlier build.
-- * The members.role column DEFAULT follows the new standard category.
-- * Stored distribution rules (system_settings.distribution_rules) are remapped
--   so a rule written against a retired key does not fail the strict run-time
--   parser afterwards. Rules collapsing onto one category (Member + Investor
--   both -> Shareholder Member) keep the FIRST occurrence's percent: the sum
--   can only shrink, never exceed 100%.
--
-- members.role has NO CHECK constraint — the role CHECK from 0002 belongs to
-- users / login RBAC, which this migration does not touch. Idempotent: every
-- statement is a no-op once values are canonical.

-- 1) Fold the retired categories into the standard shareholder category.
UPDATE "members"
   SET "role" = 'Shareholder Member'
 WHERE "role" IN ('Member', 'Investor', 'Associate Member', 'Founding Member');

-- 2) Rename the exclusive project category.
UPDATE "members"
   SET "role" = 'Project Level Member'
 WHERE "role" = 'Project Member';

-- 3) NULL roles (pre-default legacy rows) read as the standard category too —
--    the run engines already fall back to 'Shareholder Member' for null.
UPDATE "members" SET "role" = 'Shareholder Member' WHERE "role" IS NULL;

-- 4) Column default follows the new standard category.
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'Shareholder Member';

-- 5) Remap stored distribution-rule role values (see header). Non-object rule
--    entries are junk the strict parser would refuse anyway — dropped here.
UPDATE "system_settings"
   SET "distribution_rules" = COALESCE((
         SELECT jsonb_agg(rule ORDER BY ord)
           FROM (
             SELECT mapped.ord AS ord,
                    mapped.rule AS rule,
                    ROW_NUMBER() OVER (
                      PARTITION BY mapped.rule ->> 'role'
                      ORDER BY mapped.ord
                    ) AS rn
               FROM (
                 SELECT ord,
                        CASE
                          WHEN jsonb_typeof(elem) = 'object' AND elem ? 'role'
                          THEN jsonb_set(elem, '{role}', to_jsonb(
                                 CASE elem ->> 'role'
                                   WHEN 'Member'           THEN 'Shareholder Member'
                                   WHEN 'Investor'         THEN 'Shareholder Member'
                                   WHEN 'Associate Member' THEN 'Shareholder Member'
                                   WHEN 'Founding Member'  THEN 'Shareholder Member'
                                   WHEN 'Project Member'   THEN 'Project Level Member'
                                   ELSE elem ->> 'role'
                                 END))
                          ELSE NULL -- non-object entry: dropped below
                        END AS rule
                   FROM jsonb_array_elements("distribution_rules")
                        WITH ORDINALITY AS t(elem, ord)
               ) mapped
              WHERE mapped.rule IS NOT NULL
           ) numbered
       ), '[]'::jsonb)
 WHERE "distribution_rules" IS NOT NULL
   AND jsonb_typeof("distribution_rules") = 'array'
   AND jsonb_array_length("distribution_rules") > 0;

DO $$
DECLARE
  v_leftover  integer;
  v_uncapped  integer;
BEGIN
  SELECT count(*) INTO v_leftover FROM "members"
   WHERE "role" IN ('Member', 'Investor', 'Associate Member', 'Founding Member', 'Project Member')
      OR "role" IS NULL;
  -- Fail-closed invariant for the exclusive category: it cannot take deposits
  -- without a cap (lib/deposit-cap.ts), so a cap-less row is always a defect.
  SELECT count(*) INTO v_uncapped FROM "members"
   WHERE "role" = 'Project Level Member' AND "deposit_cap" IS NULL AND is_deleted = false;

  RAISE NOTICE '0029_member_role_vocabulary: % retired/NULL role(s) remaining (expect 0), % Project Level Member(s) without a cap (expect 0)',
    v_leftover, v_uncapped;
END $$;
