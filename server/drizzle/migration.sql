-- ============================================================================
-- InvestWise Database Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FIX CHECK CONSTRAINTS (unblock writes)
-- ────────────────────────────────────────────────────────────────────────────

-- transactions: add 'Success' and 'Deleted' to allowed statuses
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('Success', 'Completed', 'Pending', 'Failed', 'Processing', 'Deleted'));

-- login_attempts: drop restrictive CHECK constraint
-- Existing rows may have values that don't match the old constraint.
-- Application code handles validation — no DB-level CHECK needed.
ALTER TABLE login_attempts DROP CONSTRAINT IF EXISTS login_attempts_failure_reason_check;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. MEMBERS — financial governance fields
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS monthly_deposit_target NUMERIC(15,2) DEFAULT '0',
  ADD COLUMN IF NOT EXISTS deposit_frequency VARCHAR(20) DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS join_date TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_deposit_month VARCHAR(7),
  ADD COLUMN IF NOT EXISTS total_arrears NUMERIC(15,2) DEFAULT '0',
  ADD COLUMN IF NOT EXISTS withdrawal_requests INTEGER DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. SYSTEM_SETTINGS — governance fields
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS fiscal_year_end VARCHAR(50) DEFAULT 'June',
  ADD COLUMN IF NOT EXISTS withdrawal_limit_percent NUMERIC(5,2) DEFAULT '25',
  ADD COLUMN IF NOT EXISTS withdrawal_notice_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_withdrawal_per_request NUMERIC(15,2) DEFAULT '100000',
  ADD COLUMN IF NOT EXISTS statutory_reserve_percent NUMERIC(5,2) DEFAULT '10',
  ADD COLUMN IF NOT EXISTS last_fiscal_close_date TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. FUNDS — minimum balance reserve
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE funds
  ADD COLUMN IF NOT EXISTS minimum_balance NUMERIC(15,2) DEFAULT '0';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. NEW TABLE: member_arrears
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS member_arrears (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  period_key VARCHAR(7) NOT NULL,
  required_amount NUMERIC(15,2) NOT NULL,
  actual_deposited NUMERIC(15,2) DEFAULT '0',
  shortfall NUMERIC(15,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'OUTSTANDING',
  waived_by UUID REFERENCES members(id),
  waived_reason VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arrears_member_period ON member_arrears(member_id, period_key);
CREATE INDEX IF NOT EXISTS idx_arrears_status ON member_arrears(status);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. NEW TABLE: fiscal_periods
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) DEFAULT 'OPEN',
  total_deposits NUMERIC(15,2) DEFAULT '0',
  total_withdrawals NUMERIC(15,2) DEFAULT '0',
  total_earnings NUMERIC(15,2) DEFAULT '0',
  total_expenses NUMERIC(15,2) DEFAULT '0',
  net_surplus NUMERIC(15,2) DEFAULT '0',
  statutory_reserve NUMERIC(15,2) DEFAULT '0',
  distributable_surplus NUMERIC(15,2) DEFAULT '0',
  actual_distributed NUMERIC(15,2) DEFAULT '0',
  retained_earnings NUMERIC(15,2) DEFAULT '0',
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  notes VARCHAR(1000),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_year ON fiscal_periods(year);
CREATE INDEX IF NOT EXISTS idx_fiscal_status ON fiscal_periods(status);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. NEW TABLE: profit_allocations
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profit_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fiscal_period_id UUID REFERENCES fiscal_periods(id),
  member_id UUID NOT NULL REFERENCES members(id),
  allocation_type VARCHAR(50) NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  shares_at_time INTEGER NOT NULL,
  rate_per_share NUMERIC(15,6) NOT NULL,
  notes VARCHAR(500),
  allocated_by UUID REFERENCES users(id),
  allocated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allocation_period ON profit_allocations(fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_allocation_member ON profit_allocations(member_id);
CREATE INDEX IF NOT EXISTS idx_allocation_type ON profit_allocations(allocation_type);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. FIX blacklisted_tokens (token column needs to handle long JWTs)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE blacklisted_tokens
  ALTER COLUMN token TYPE TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- DONE. Verify with: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- ============================================================================
