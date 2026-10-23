-- 0021_lists_created_at_index
-- Transactions, expenses and meetings lists default to newest-CREATED first
-- (createdAt DESC) instead of the business date, with date/id kept only as
-- deterministic tiebreakers. Deposits deliberately keeps business-date
-- ordering (finance convention — AGENTS.md §2). Project updates also order by
-- createdAt but are NOT covered by an index here (smaller set, per-project
-- filters dominate).
--
-- The old sort keys (transactions.date, meetings.meeting_date) had tenant
-- composite indexes; created_at had none, so each list page would filter by
-- tenant and then sort the whole result set. These two indexes let the planner
-- walk tenant rows already in newest-first order.
--
-- Re-runnable: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS "idx_trans_tenant_created"
    ON "transactions" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_meetings_tenant_created"
    ON "meetings" ("tenant_id", "created_at" DESC);
