-- 0015_project_investment_source_fund
-- Project creation deducted a member's deposit EQUITY (total_contributed) and
-- credited the project fund, but never debited the deposit fund that actually
-- held the cash. Result: a member who deposited 21000 and invested 8000 showed
-- deposit fund 21000 AND project fund 8000 — the treasury overstated assets by
-- the invested amount.
--
-- This column records WHICH fund the capital left, so creation can debit it and
-- project deletion can credit the same fund back. Purely additive: existing
-- rows stay NULL (unknown source) and are reconciled separately, never guessed.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "source_fund_id" uuid;

-- FK added separately because ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_source_fund_id_fkey'
  ) THEN
    ALTER TABLE "transactions"
      ADD CONSTRAINT "transactions_source_fund_id_fkey"
      FOREIGN KEY ("source_fund_id") REFERENCES "funds"("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_trans_source_fund"
  ON "transactions" ("source_fund_id", "is_deleted");
