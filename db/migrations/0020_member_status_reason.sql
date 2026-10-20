-- 0020_member_status_reason
-- Separate a member's lifecycle STATE from the REASON they are in it.
--
-- `members.status` (active | inactive | suspended) answers "what state?" but
-- not "why?". Two members both reading "Inactive" were indistinguishable: one
-- auto-held by the deposit-compliance sweep (recoverable by depositing), the
-- other having transferred all equity + shares away (not recoverable that way).
-- The governance sweep only looks at `status`, so it would AUTO_RESTORE the
-- second member on the next run — silently erasing the real reason.
--
-- `status_reason` records the cause so the sweep can tell which holds it owns:
--   DEPOSIT_NON_COMPLIANCE  the sweep auto-held them (it may auto-restore).
--   EQUITY_TRANSFERRED_OUT  equity + shares moved away (admin action only).
--   ADMIN_MANUAL            an admin set the state by hand (admin action only).
--   NULL                    active, or a legacy row predating this column.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS; the CHECK is added through a guarded
-- DO block (ADD CONSTRAINT has no IF NOT EXISTS).

ALTER TABLE "members"
  ADD COLUMN IF NOT EXISTS "status_reason" varchar(50);

-- Best-effort backfill for rows that predate the column. The equity-transfer
-- path is the only producer that leaves a member with zero contributed balance
-- AND zero shares, so that pair identifies it; every other inactive row is
-- attributed to the sweep (its dominant producer), and suspended rows to the
-- admin action that is the only thing that can suspend. Active/pending rows
-- stay NULL.
UPDATE "members"
   SET "status_reason" = 'EQUITY_TRANSFERRED_OUT'
 WHERE "status" = 'inactive'
   AND COALESCE("total_contributed", 0) = 0
   AND COALESCE("shares", 0) = 0;

UPDATE "members"
   SET "status_reason" = 'DEPOSIT_NON_COMPLIANCE'
 WHERE "status" = 'inactive'
   AND "status_reason" IS NULL;

UPDATE "members"
   SET "status_reason" = 'ADMIN_MANUAL'
 WHERE "status" = 'suspended'
   AND "status_reason" IS NULL;

-- Active (and any other) rows carry no reason.
UPDATE "members"
   SET "status_reason" = NULL
 WHERE "status" NOT IN ('inactive', 'suspended');

ALTER TABLE "members"
  DROP CONSTRAINT IF EXISTS "chk_members_status_reason";

ALTER TABLE "members"
  ADD CONSTRAINT "chk_members_status_reason" CHECK (
    "status_reason" IS NULL
    OR "status_reason" IN ('DEPOSIT_NON_COMPLIANCE', 'EQUITY_TRANSFERRED_OUT', 'ADMIN_MANUAL')
  );

COMMENT ON COLUMN "members"."status_reason" IS
  'Why the member is not active: DEPOSIT_NON_COMPLIANCE | EQUITY_TRANSFERRED_OUT | ADMIN_MANUAL (NULL = active/legacy).';