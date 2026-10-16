-- 0016: Soft-delete support for project_updates.
--
-- project_updates is a project-scoped mirror of the ledger transaction that
-- backs a project financial posting (Earning/Expense). The "Financial Updates"
-- tab on a project reads project_updates, but the ledger's soft-delete
-- (DELETE /api/transactions/[id]) never touched it, so deleted postings kept
-- showing there while correctly vanishing from the Timeline (which reads
-- transactions with is_deleted = false).
--
-- This adds an is_deleted flag that the transaction delete/restore routes keep
-- in sync. The two rows are always written with the same (project, type,
-- amount, date, balance_after), so that is the match key; there is no explicit
-- FK because transactions already references projects (a reverse reference
-- would be circular). The backfill flags existing orphans whose ledger
-- transaction is already soft-deleted.
--
-- Idempotent: safe to re-run.

ALTER TABLE "project_updates"
  ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_project_updates_is_deleted"
  ON "project_updates" ("is_deleted");

-- Backfill: flag mirrors whose ledger transaction was already soft-deleted.
DO $$
BEGIN
  UPDATE "project_updates" pu
     SET "is_deleted" = true
    FROM "transactions" t
   WHERE t."project_id" = pu."project_id"
     AND t."tenant_id"  = pu."tenant_id"
     AND t."type"       = pu."type"
     AND t."amount"     = pu."amount"
     AND t."date"       = pu."date"
     AND (t."balance_after" = pu."balance_after"
          OR (t."balance_after" IS NULL AND pu."balance_after" IS NULL))
     AND t."is_deleted" = true;
END
$$;
