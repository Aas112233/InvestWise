-- 0010_production_hardening
-- Security + integrity follow-ups from the Oct-2026 production-readiness audit.
--
-- Renamed from 0009_production_hardening (2026-10-05): 0009 was already taken
-- by 0009_ledger_integrity.sql, and two files sharing a numeric prefix makes
-- the migrate runner's filename sort ambiguous. This file must sort AFTER
-- 0009 because it depends on the transactions indexes 0009 creates.
--
-- Why:
--   1) "users.email" was UNIQUE GLOBALLY. In this shared-DB multi-tenant model
--      that is a cross-tenant existence oracle (the create/login path can
--      reveal that an address exists in ANOTHER tenant) and it blocks the same
--      natural person from being a user in more than one tenant. Uniqueness
--      moves to (tenant_id, email), with platform operators (tenant_id IS
--      NULL) still unique among themselves.
--   2) The deposits month view filtered on COALESCE(deposit_month, …) — a
--      function expression no index can serve, so it full-scanned the tenant
--      ledger. Adds a (tenant_id, deposit_month, date) composite.
--   3) Members' identity columns already sit under composite uniques (0007);
--      these indexes keep the tenant-scoped lookups that back login and the
--      member directory index-only.
--
-- Re-runnable: IF NOT EXISTS / guarded DO blocks throughout. Also mirrored in
-- db/schema/*.ts and applied to dev via `npm run db:migrate`.

-- ------------------------------------------- users.email scoped per tenant
DO $$
DECLARE r RECORD;
BEGIN
  -- Drop the legacy GLOBAL unique constraint/index on users.email.
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'users'::regclass AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1 AND a.attname = 'email'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS "users_email_unique";
DROP INDEX IF EXISTS "users_email_key";

-- Composite uniqueness: email unique within a tenant, and unique among
-- platform operators (tenant_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_tenant_email"
  ON "users" USING btree ("tenant_id", "email")
  WHERE "tenant_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_platform_email"
  ON "users" USING btree ("email")
  WHERE "tenant_id" IS NULL;

-- ------------------------------------------- deposit-month composite index
CREATE INDEX IF NOT EXISTS "idx_trans_tenant_deposit_month"
  ON "transactions" USING btree ("tenant_id", "deposit_month", "date" DESC);

-- ------------------------------------------- tenant-scoped user lookup index
CREATE INDEX IF NOT EXISTS "idx_users_tenant_email"
  ON "users" USING btree ("tenant_id", "email");
