-- #48 — Goal progress provenance.
--
-- Goal `current_amount` was a hand-typed free-numeric field rendered as
-- "ACCUMULATED SAVINGS" with a progress bar, giving ledger-unverifiable
-- figures the same visual authority as real fund balances. Until goals can be
-- funded by a real allocation from a fund, every goal must carry where its
-- progress came from. `Manual` (the default, and the only value the API can
-- set today) is surfaced in the UI as "Manual — unverified".
--
-- Values: Manual | Allocation   (Allocation reserved for the future
-- reserve-transfer feature; no writer exists yet.)
--
-- Idempotent: safe to re-run.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS progress_source varchar(20) NOT NULL DEFAULT 'Manual';

-- Guard the vocabulary in the database too, so a future writer cannot invent a
-- third source the UI does not know how to label.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_progress_source_check'
  ) THEN
    ALTER TABLE goals
      ADD CONSTRAINT goals_progress_source_check
      CHECK (progress_source IN ('Manual', 'Allocation'));
  END IF;
END $$;
