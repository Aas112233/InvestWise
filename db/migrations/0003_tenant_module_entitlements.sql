-- 0003_tenant_module_entitlements.sql
-- Per-tenant module licensing. A tenant is licensed for a subset of the
-- modules enumerated in lib/tenant-modules.ts; the platform operator toggles
-- them from /admin/feature-flags and the tenant inspector.
--
-- Storage contract (matches resolveModuleAccess in lib/tenant-modules.ts):
--   NULL, '{}', or a partial object  ->  every module at its declared default
--   full object                      ->  exactly the booleans stored
-- Required modules (members, funds, settings) are forced true on read, so a
-- hand-edited row can never lock a tenant out of its own data.
--
-- Idempotent: guarded on column existence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'module_access'
  ) THEN
    ALTER TABLE tenants ADD COLUMN module_access jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Backfill any pre-existing tenant to an explicit "everything at default"
-- object, so the panel shows a real value rather than relying on the NULL
-- fallback. Safe to re-run.
UPDATE tenants
SET module_access = COALESCE(module_access, '{}'::jsonb)
WHERE module_access IS NULL;

-- ---------------------------------------------------------------------------
-- platform_settings: one row (id = 1) holding SaaS-wide defaults and the
-- operator-facing identity of the platform itself. Distinct from the
-- per-tenant system_settings table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_settings (
  id                        integer     PRIMARY KEY DEFAULT 1,
  platform_name             varchar(120) NOT NULL DEFAULT 'InvestWise',
  support_email             varchar(255),
  support_phone             varchar(40),
  default_trial_days        integer     NOT NULL DEFAULT 30,
  default_currency          varchar(10)  NOT NULL DEFAULT 'BDT',
  default_timezone          varchar(60)  NOT NULL DEFAULT 'Asia/Dhaka',
  allow_public_registration boolean     NOT NULL DEFAULT true,
  global_maintenance_mode   boolean     NOT NULL DEFAULT false,
  maintenance_message       varchar(500),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- "the" platform settings row. A second row would make the settings
  -- ambiguous, so the constraint enforces the singleton rather than trusting
  -- every writer to remember id = 1.
  CONSTRAINT platform_settings_singleton CHECK (id = 1),
  CONSTRAINT platform_settings_trial_days_range CHECK (default_trial_days BETWEEN 1 AND 365)
);

INSERT INTO platform_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
