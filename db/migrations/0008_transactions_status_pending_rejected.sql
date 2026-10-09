-- 0008_transactions_status_pending_rejected
-- Deposit lifecycle: the request/approve/reject/revert flows write PENDING and
-- REJECTED (uppercase) on transactions.status, but the live
-- transactions_status_check only allowed Success/Completed/Pending/Failed/
-- Processing/Deleted — every revert (and every member request + reject) 500d
-- with pgCode 23514 (audit: deposit-revert 500, Oct 2026).
--
-- Direction follows the funds_type_check precedent: the constraint follows the
-- application vocabulary, not the reverse. The UI compares case-insensitively
-- (toUpperCase), the filter dropdown sends PENDING/REJECTED, and audit text
-- records them — renaming in code would touch ~6 files for zero benefit.
--
-- Purely additive: all previously allowed values stay allowed, so legacy rows
-- in any environment keep passing. No data UPDATE needed (no PENDING/REJECTED
-- row could ever have been written while the old check stood).
--
-- Re-runnable: DROP IF EXISTS + ADD.

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_status_check";

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_status_check" CHECK (
    (status)::text = ANY (ARRAY[
      'Success', 'Completed', 'Pending', 'Failed', 'Processing', 'Deleted',
      'PENDING', 'REJECTED'
    ]::text[])
  );
