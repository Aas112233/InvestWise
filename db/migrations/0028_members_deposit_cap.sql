-- 0028_members_deposit_cap
-- Lifetime deposit ceiling for the exclusive 'Project Member' category
-- (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §3.2): the cumulative sum of the
-- member's settled deposit ledger rows may never exceed this amount.
--
--   * ADDITIVE ONLY. No existing column, row or index is touched; every
--     existing member keeps NULL, which means "no cap" — and only a
--     Project Member can ever carry a non-NULL cap (enforced by the API;
--     the column is role-agnostic at the DB level so the vocabulary stays
--     free to evolve).
--   * The cap SEMANTICS (cumulative deposits, not live balance; withdrawals
--     do not free headroom) live in lib/deposit-cap.ts — the single owner —
--     not in a CHECK constraint.
--   * The bound project of a Project Member is NOT a column here:
--     project_members stays the single source of truth for project
--     membership, and the one-project invariant is enforced where those
--     rows are written (lib/project-capital.ts).
--
-- Re-runnable: IF NOT EXISTS guarded, house style of 0025/0027.

ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "deposit_cap" decimal(15,2);

DO $$
DECLARE
  v_total    integer;
  v_capped   integer;
BEGIN
  SELECT count(*) INTO v_total  FROM "members" WHERE is_deleted = false;
  SELECT count(*) INTO v_capped FROM "members" WHERE is_deleted = false AND "deposit_cap" IS NOT NULL;

  RAISE NOTICE '0028_members_deposit_cap: % live member(s), % with a deposit cap (expected 0 on first run)',
    v_total, v_capped;
END $$;
