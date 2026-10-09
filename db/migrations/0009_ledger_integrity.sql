-- 0009_ledger_integrity
-- Ledger integrity: brings transactions/system_settings DDL that previously
-- existed only in db/schema/*.ts and the dev boot hook (instrumentation.ts)
-- into the checked-in migration chain, and enforces (tenant_id,
-- reference_number) uniqueness among live rows at the database level.
--
-- Why the unique reference index: the deposit/expense/dividend POST routes
-- dedupe references with a SELECT-then-INSERT pair, which races under
-- concurrent submits — two identical receipts can land milliseconds apart and
-- double-credit a fund. A partial UNIQUE index is the only enforcement that
-- survives the race (AGENTS.md §12 idempotency invariant); the app keeps its
-- friendlier pre-check on top.
--
-- Why the dedup step: the old idx_trans_tenant_reference was NON-unique, so
-- existing databases may already hold duplicate (tenant_id, reference_number)
-- pairs among live rows and CREATE UNIQUE INDEX would abort on the first one.
-- For every duplicated group the OLDEST row (earliest created_at, id as
-- tiebreaker) keeps the original reference; each older twin is re-keyed to
-- '<reference>-DUP-<first 8 chars of row id>' — deterministic, keeps the
-- original reference readable inside the value, and the id-derived suffix
-- makes an accidental collision with another row's reference practically
-- impossible. The head is capped at 242 chars so reference + '-DUP-' + 8-char
-- suffix always fits varchar(255) instead of aborting the migration on a
-- pathological input. Soft-deleted rows are excluded (they are invisible to the
-- dup-check queries AND to the partial index) and so are NULL tenant_id rows
-- (a unique index treats NULL indexed values as never conflicting, so they
-- cannot block creation and must not be re-keyed).
--
-- Re-runnable: IF NOT EXISTS / IF EXISTS / guarded statements throughout.
-- Mirrors db/schema/transactions.ts + db/schema/system_settings.ts.

-- ------------------------------------------- transactions: late-applied columns
-- These lived only in db/schema/transactions.ts (+ dev boot DDL) until now;
-- databases built from the migration chain alone were missing them.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "expense_name" varchar(255);
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "transfer_group_id" uuid;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "deposit_month" varchar(7);

-- ------------------------------------------- system_settings: column backfill
-- Columns present in db/schema/system_settings.ts but absent from every
-- migration file (they predate the migration chain — dev databases got them
-- via db:push). late_deposit_grace_months / inactive_after_months /
-- suspended_after_months are also added by 0006 and repeated here on purpose:
-- each migration file stays individually re-runnable and self-contained.
ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "late_deposit_grace_months" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "inactive_after_months"     integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "suspended_after_months"    integer DEFAULT 6;

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "company_name"              varchar(150) DEFAULT 'InvestWise',
  ADD COLUMN IF NOT EXISTS "company_tagline"           varchar(255) DEFAULT 'Enterprise Investment Management',
  ADD COLUMN IF NOT EXISTS "company_address"           varchar(255) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "company_email"             varchar(100) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "company_phone"             varchar(50) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "company_website"           varchar(100) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "company_reg_no"            varchar(50) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fiscal_year_start"         varchar(50) DEFAULT 'July',
  ADD COLUMN IF NOT EXISTS "fiscal_year_end"           varchar(50) DEFAULT 'June',
  ADD COLUMN IF NOT EXISTS "base_currency"             varchar(10) DEFAULT '',
  ADD COLUMN IF NOT EXISTS "tax_rate"                  numeric(5, 2) DEFAULT '15.0',
  ADD COLUMN IF NOT EXISTS "accounting_method"         varchar(50) DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS "share_value_bdt"           numeric(15, 2) DEFAULT '1000',
  ADD COLUMN IF NOT EXISTS "is_share_value_locked"     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "withdrawal_limit_percent"  numeric(5, 2) DEFAULT '25',
  ADD COLUMN IF NOT EXISTS "withdrawal_notice_days"    integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "max_withdrawal_per_request" numeric(15, 2) DEFAULT '100000',
  ADD COLUMN IF NOT EXISTS "statutory_reserve_percent" numeric(5, 2) DEFAULT '10',
  ADD COLUMN IF NOT EXISTS "last_fiscal_close_date"    timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "language"                  varchar(50) DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS "refresh_interval"          varchar(50) DEFAULT 'Real-time',
  ADD COLUMN IF NOT EXISTS "theme"                     varchar(50) DEFAULT 'Light',
  ADD COLUMN IF NOT EXISTS "date_format"               varchar(50) DEFAULT 'DD/MM/YYYY',
  ADD COLUMN IF NOT EXISTS "is_maintenance_mode"       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "monthly_meeting_day"       integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "deposit_due_date"          integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "grace_period_days"         integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "meeting_types"             jsonb DEFAULT '["FOUNDING_MEMBER", "SHAREHOLDER", "INVESTOR"]'::jsonb,
  ADD COLUMN IF NOT EXISTS "penalty_rules"             jsonb DEFAULT '[{"tier":1,"title":"1st Offense - Verbal Warning","type":"VERBAL_WARNING","deductionAmount":0,"isPercentage":false},{"tier":2,"title":"2nd Offense - Minor Fine","type":"FUND_DEDUCTION","deductionAmount":50,"isPercentage":false},{"tier":3,"title":"3rd Offense - Major Fine","type":"FUND_DEDUCTION","deductionAmount":200,"isPercentage":false},{"tier":4,"title":"4th Offense - Suspension & Severe Deduction","type":"SUSPENSION","deductionAmount":500,"isPercentage":false}]'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_updated_by"           uuid,
  ADD COLUMN IF NOT EXISTS "last_updated_at"           timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_at"                timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at"                timestamp with time zone DEFAULT now();

-- ------------------------------------------- ledger search (trgm) indexes
-- GET /api/transactions?search= runs contains-matching (ILIKE '%term%') over
-- reference number, description, and the string form of the row id. Without
-- gin_trgm_ops every search seq-scanned the tenant ledger.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_trans_ref_trgm"
  ON "transactions" USING gin ("reference_number" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_trans_desc_trgm"
  ON "transactions" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_trans_id_text_trgm"
  ON "transactions" USING gin (("id"::text) gin_trgm_ops);

-- ------------------------------------------- remaining transactions indexes
-- Defined in db/schema/transactions.ts but absent from the migration chain
-- (dev databases got them via db:push; databases built from migrations did
-- not). idx_trans_tenant_deposit_month is also added by
-- 0009_production_hardening; repeated here so this file alone leaves the
-- ledger fully indexed.
CREATE INDEX IF NOT EXISTS "idx_trans_member_type_status_deleted_date"
  ON "transactions" USING btree ("member_id","type","status","is_deleted","date" DESC);

CREATE INDEX IF NOT EXISTS "idx_trans_fund_type_status_deleted_date"
  ON "transactions" USING btree ("fund_id","type","status","is_deleted","date" DESC);

CREATE INDEX IF NOT EXISTS "idx_trans_project_type_status_deleted_date"
  ON "transactions" USING btree ("project_id","type","status","is_deleted","date" DESC);

CREATE INDEX IF NOT EXISTS "idx_trans_type_status_deleted_date"
  ON "transactions" USING btree ("type","status","is_deleted","date" DESC);

CREATE INDEX IF NOT EXISTS "idx_trans_member_fund_type_date"
  ON "transactions" USING btree ("member_id","fund_id","type","date");

CREATE INDEX IF NOT EXISTS "idx_trans_date_status"
  ON "transactions" USING btree ("date" DESC,"status","is_deleted");

CREATE INDEX IF NOT EXISTS "idx_trans_tenant_deposit_month"
  ON "transactions" USING btree ("tenant_id","deposit_month","date" DESC);

-- ------------------------------------------- unique (tenant_id, reference_number)
-- Step 1 — neutralize existing duplicates among LIVE rows so the unique index
-- below can be created (see header: oldest row by created_at keeps the
-- original reference; older twins get the '-DUP-' || left(id::text, 8) suffix).
-- Soft-deleted and NULL-tenant rows are skipped — they cannot block a partial
-- unique index whose indexed columns include tenant_id/reference_number.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, reference_number
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM "transactions"
  WHERE "tenant_id" IS NOT NULL
    AND "reference_number" IS NOT NULL
    AND "is_deleted" = false
)
UPDATE "transactions" t
SET "reference_number" = left(t."reference_number", 242) || '-DUP-' || left(t."id"::text, 8)
FROM ranked r
WHERE t."id" = r."id"
  AND r."rn" > 1;

-- Step 2 — replace the non-unique dup-check index with a partial UNIQUE index.
-- WHERE clause matches db/schema/transactions.ts (uniqueIndex().where(sql`...`)).
DROP INDEX IF EXISTS "idx_trans_tenant_reference";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trans_tenant_reference"
  ON "transactions" USING btree ("tenant_id", "reference_number")
  WHERE "is_deleted" = false AND "reference_number" IS NOT NULL;

COMMENT ON INDEX "uq_trans_tenant_reference" IS
  'Idempotency: one live row per (tenant_id, reference_number). Database-level backstop for the app dup-check — concurrent submits cannot double-credit a fund.';
