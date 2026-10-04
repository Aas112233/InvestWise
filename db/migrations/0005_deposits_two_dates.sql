-- 0005_deposits_two_dates
-- Deposits two-date model: date = collected date (canonical money movement),
-- submitted_date = recorded date. Backfills submitted_date from created_at.
-- Re-runnable: IF NOT EXISTS guarded.

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "submitted_date" timestamp with time zone DEFAULT now();

-- Backfill existing rows where submitted_date is NULL from created_at.
UPDATE "transactions" SET "submitted_date" = "created_at" WHERE "submitted_date" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_trans_tenant_submitted_date" ON "transactions" USING btree ("tenant_id", "submitted_date" DESC NULLS LAST);
