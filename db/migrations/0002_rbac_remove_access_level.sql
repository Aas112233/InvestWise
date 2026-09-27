-- 0002_rbac_remove_access_level.sql
-- RBAC migration: numeric access levels (1-5) are removed. Authorization now
-- derives from the canonical role in users.role (SuperAdmin | Admin |
-- Manager | Auditor | Member, normalized by lib/roles.ts).
--
-- 1. Normalize roles from the old access_level (platform invariant: level 5
--    was platform-only, so level>=5 becomes SuperAdmin; otherwise normalize
--    legacy role strings to canonical roles).
-- 2. Drop idx_users_access_level + the access_level column.
-- Idempotent: every statement guards on column/index existence.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'access_level'
  ) THEN
    -- The old role check enumerates legacy roles (no SuperAdmin): drop it
    -- first so normalization below is not blocked, then add the canonical
    -- RBAC check at the end.
    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";

    -- Platform operators first (level 5 was platform-only per admin-guard).
    UPDATE "users" SET role = 'SuperAdmin'
    WHERE access_level >= 5 AND (role IS NULL OR role <> 'SuperAdmin');

    -- Legacy role strings to canonical roles.
    UPDATE "users" SET role = 'Admin'
    WHERE role IN ('Administrator');
    UPDATE "users" SET role = 'Manager'
    WHERE role IN ('Cashier', 'Officer');
    UPDATE "users" SET role = 'Auditor'
    WHERE role IN ('Audit', 'Auditor');
    UPDATE "users" SET role = 'Member'
    WHERE role IN (
      'Founding Member', 'Normal Shareholder', 'Shareholder',
      'Investor', 'Associate Member', 'Viewer', 'Guest'
    );

    -- Anything still unmapped becomes the standard baseline.
    UPDATE "users" SET role = 'Member'
    WHERE role IS NULL
       OR role NOT IN ('SuperAdmin', 'Admin', 'Manager', 'Auditor', 'Member');

    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_check"
      CHECK (role IN ('SuperAdmin', 'Admin', 'Manager', 'Auditor', 'Member'));

    DROP INDEX IF EXISTS "idx_users_access_level";
    ALTER TABLE "users" DROP COLUMN IF EXISTS "access_level";
  END IF;
END $$;
