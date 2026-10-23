-- 0022_tenant_timezone
-- Date-handling Tier 1: business days must be counted on the TENANT's wall
-- clock, not UTC or the viewer's browser. system_settings gains an IANA
-- `timezone` column; lib/tenant-time.ts evaluates ledger date filters and
-- month attribution against it.
--
-- Seeded with the platform default (Asia/Dhaka) so every existing tenant's
-- books behave exactly as before this column existed — no day shifts retroactively.
-- Admins can change it under Settings → System.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS; the UPDATE only fills NULLs.

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "timezone" varchar(60) NOT NULL DEFAULT 'Asia/Dhaka';

UPDATE "system_settings"
   SET "timezone" = 'Asia/Dhaka'
 WHERE "timezone" IS NULL OR "timezone" = '';

COMMENT ON COLUMN "system_settings"."timezone" IS
  'IANA timezone of the tenant''s books; business-day filters and month attribution use this clock.';
