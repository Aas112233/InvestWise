-- 0017: link project_updates to the ledger transaction each posting created.
--
-- The printable "Project Update Receipt" is keyed on the transactions row
-- (reference number, member and handling officer live there, not on
-- project_updates), so reprinting a spending row from the table needs this
-- link. New postings set it in code (the insert order in the POST route was
-- changed for it); the backfill below recovers it for historical rows.

ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS transaction_id UUID;

-- Best-effort backfill: a project posting writes exactly one ledger row with
-- the same project, type ('Earning'/'Expense'), amount and timestamp, so
-- match on those. Each transaction is assigned to at most one update (its
-- oldest match). Two identical postings for one project at the same instant
-- are the only case that cannot be ordered further — rare, and it only
-- decides which of two sibling references a reprint shows.
WITH ranked AS (
  SELECT
    pu.id AS update_id,
    t.id  AS transaction_id,
    ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY pu.created_at) AS rn
  FROM project_updates pu
  JOIN transactions t
    ON t.project_id = pu.project_id
   AND t.tenant_id  = pu.tenant_id
   AND t.type       = pu.type
   AND t.amount     = pu.amount
   AND t.date       = pu.date
   AND t.is_deleted = false
  WHERE pu.transaction_id IS NULL
)
UPDATE project_updates
SET transaction_id = r.transaction_id
FROM ranked r
WHERE project_updates.id = r.update_id
  AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_updates_transaction
  ON project_updates (transaction_id);
