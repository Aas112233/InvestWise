-- 0007_members_tenant_scoped_identity
-- Member directory: per-tenant identity + soft delete.
--
-- Why (audit findings #3/#4, October 2026):
--   1) "members.member_id" and "members.email" were UNIQUE GLOBALLY. In this
--      shared-DB multi-tenant model that means two organizations cannot
--      register the same natural person's email, and the create route's
--      "already exists" 409 lets any tenant probe whether an address belongs
--      to ANOTHER tenant's member (cross-tenant existence oracle).
--      Uniqueness now lives per (tenant_id, member_id) and (tenant_id, email).
--   2) Members were HARD-DELETED, silently cascading away meeting attendance,
--      project membership and arrears (ON DELETE CASCADE FKs) — against the
--      module spec's soft-delete requirement. New columns follow the
--      transactions pattern: is_deleted + deleted_by + deletion_reason.
--
-- Re-runnable: IF NOT EXISTS / guarded DO blocks throughout.

-- ------------------------------------------------- soft-delete columns
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "deleted_by" uuid;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "deletion_reason" varchar(500);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_deleted_by_users_id_fk') THEN
    ALTER TABLE "members" ADD CONSTRAINT "members_deleted_by_users_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

-- ------------------------------------------------- drop the global uniques
-- Constraint names from the pre-migration base schema are not guaranteed, so
-- drop every single-column UNIQUE constraint over email / member_id by
-- looking them up in the catalog — name-agnostic and re-runnable.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'members'::regclass
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND a.attname IN ('email', 'member_id')
  LOOP
    EXECUTE format('ALTER TABLE members DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Orphan standalone unique indexes (belt and suspenders; IF EXISTS-guarded).
DROP INDEX IF EXISTS "members_email_unique";
DROP INDEX IF EXISTS "members_member_id_unique";

-- ------------------------------------------------- per-tenant uniques
-- memberId: permanent code, unique over live + soft-deleted rows (never reused).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_members_tenant_member_id" ON "members" USING btree ("tenant_id","member_id");

-- email: unique only over LIVE rows. Soft-deleting a member frees their email
-- for re-registration; a full unique would make that a 23505 and the create
-- route's (is_deleted=false) dup-check would never see the deleted row. Partial
-- index keeps the DB and the application logic in lockstep. Dropped and rebuilt
-- as partial so an earlier full version (same name) converges on re-run.
DROP INDEX IF EXISTS "uq_members_tenant_email";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_members_tenant_email"
  ON "members" USING btree ("tenant_id","email") WHERE "is_deleted" = false;

-- Directory reads filter (tenant_id, is_deleted) on every page of the table.
CREATE INDEX IF NOT EXISTS "idx_members_tenant_is_deleted" ON "members" USING btree ("tenant_id","is_deleted");

COMMENT ON COLUMN "members"."is_deleted" IS
  'Soft delete flag (§12): row and ledger history survive; directory, dropdowns and dividend rosters exclude it.';
COMMENT ON COLUMN "members"."deletion_reason" IS
  'Why the member was removed from the directory (audit trail, mirrors transactions.deletion_reason).';
