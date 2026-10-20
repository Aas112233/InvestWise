-- 0019_member_payouts
-- Suspended-member exit settlement ("payout").
--
-- A suspended member who leaves the organisation must be paid back the money
-- they actually hold: deposits + dividends − capital already invested in
-- projects. It can be paid in one go or in phases (monthly, every two months,
-- ...), and each phase moves cash only when an officer confirms the handover.
--
-- Before this, nothing recorded an exit at all: an officer had to improvise a
-- Withdrawal transaction, which left the member's balance, the fund debit and
-- the remaining obligations with no shared source of truth.
--
-- The plan row is that source of truth (what was promised, from which fund, on
-- what schedule) and the installment rows are the phases. `member_id` carries a
-- PARTIAL UNIQUE on status = 'ACTIVE': two open plans would reserve the same
-- balance twice and pay it out twice (§12 idempotency).
--
-- Re-runnable: CREATE TABLE / CREATE INDEX IF NOT EXISTS, and every
-- CHECK constraint is added through a guarded DO block (ADD CONSTRAINT has
-- no IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "member_payout_plans" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid NOT NULL REFERENCES "tenants"("id"),
  "member_id"          uuid NOT NULL REFERENCES "members"("id"),
  "status"             varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "total_amount"       decimal(15,2) NOT NULL,
  "paid_amount"        decimal(15,2) NOT NULL DEFAULT '0',
  "installment_count"  integer NOT NULL DEFAULT 1,
  "interval_months"    integer NOT NULL DEFAULT 1,
  "first_due_date"     timestamptz NOT NULL,
  "source_fund_id"     uuid NOT NULL REFERENCES "funds"("id"),
  "reason"             text NOT NULL,
  "created_by"         uuid REFERENCES "users"("id"),
  "updated_by"         uuid REFERENCES "users"("id"),
  "cancelled_at"       timestamptz,
  "cancel_reason"      text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "member_payout_installments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id"),
  "plan_id"        uuid NOT NULL REFERENCES "member_payout_plans"("id"),
  "sequence"       integer NOT NULL,
  "due_date"       timestamptz NOT NULL,
  "amount"         decimal(15,2) NOT NULL,
  "status"         varchar(20) NOT NULL DEFAULT 'SCHEDULED',
  "paid_at"        timestamptz,
  "transaction_id" uuid REFERENCES "transactions"("id"),
  "created_by"     uuid REFERENCES "users"("id"),
  "updated_by"     uuid REFERENCES "users"("id"),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_payout_plans_tenant_status"
  ON "member_payout_plans" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_payout_plans_member"
  ON "member_payout_plans" ("member_id");
CREATE INDEX IF NOT EXISTS "idx_payout_plans_created_at"
  ON "member_payout_plans" ("created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payout_one_open_plan_per_member"
  ON "member_payout_plans" ("member_id") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payout_installment_sequence"
  ON "member_payout_installments" ("plan_id", "sequence");
CREATE INDEX IF NOT EXISTS "idx_payout_installments_tenant_status_due"
  ON "member_payout_installments" ("tenant_id", "status", "due_date");

-- Status vocabularies follow the schema, same direction as the existing
-- transactions_status_check / funds_type_check constraints.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payout_plans_status_check') THEN
    ALTER TABLE "member_payout_plans"
      ADD CONSTRAINT "member_payout_plans_status_check"
      CHECK ("status"::text = ANY (ARRAY['ACTIVE','COMPLETED','CANCELLED']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payout_plans_amount_checks') THEN
    ALTER TABLE "member_payout_plans"
      ADD CONSTRAINT "member_payout_plans_amount_checks"
      CHECK ("total_amount"::numeric > 0
        AND "paid_amount"::numeric >= 0
        AND "paid_amount"::numeric <= "total_amount"::numeric
        AND "installment_count" >= 1
        AND "interval_months" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payout_installments_status_check') THEN
    ALTER TABLE "member_payout_installments"
      ADD CONSTRAINT "member_payout_installments_status_check"
      CHECK ("status"::text = ANY (ARRAY['SCHEDULED','PAID','CANCELLED']::text[]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_payout_installments_amount_checks') THEN
    ALTER TABLE "member_payout_installments"
      ADD CONSTRAINT "member_payout_installments_amount_checks"
      CHECK ("amount"::numeric > 0 AND "sequence" >= 1);
  END IF;
END $$;
