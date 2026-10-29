-- 0024_normalize_deposit_category
-- Bring settled deposit rows onto the canonical ledger category.
--
-- `transactions.category` for deposits had become uncontrolled free text,
-- because no two write paths agreed:
--
--   * POST /api/deposits              wrote 'Deposit'
--   * bulkAddDeposits (Excel/bulk)    wrote NOTHING  -> category IS NULL
--   * the request routes              wrote 'Deposit Request', and approval
--                                     flipped only `status`, never `category`,
--                                     so a settled deposit kept the slip's label
--                                     for the rest of its life
--   * legacy seeds                    wrote 'Member Deposit' / 'Monthly Deposit'
--
-- The report's Category column reads this field, so approved bulk deposits did
-- not appear as deposits. Ledger TOTALS were never wrong: every report filter
-- keys on `type` + `status` (SETTLED_DEPOSIT_STATUSES), never category.
--
-- Scope is deliberately narrow.
--
-- ONLY SETTLED rows are touched. GET /api/deposits excludes pending slips with
-- `status = 'PENDING' AND category = 'Deposit Request'`, and the finance service
-- releases a member's deposit month once `category = 'Deposit'`; relabelling a
-- still-pending request would silently move it onto the management desk and free
-- up its month reservation before anyone approved it. Pending slips must keep the
-- slip label.
--
-- 'Member Deposit' and 'Monthly Deposit' are NOT touched: ~2,000 rows, and
-- whether those are distinct categories the tenant reports on separately, or
-- simply older spellings of the same thing, is a product decision rather than
-- something a migration should assume.
--
-- `updated_at` is intentionally left alone. This is a relabelling of historical
-- data, not a business edit; bumping it would make thousands of long-settled
-- rows look as though an officer just modified them.
--
-- Idempotent: after the first run the predicate matches no rows.

DO $$
DECLARE
  v_null      integer;
  v_request   integer;
BEGIN
  SELECT count(*) INTO v_null    FROM "transactions"
   WHERE "type" = 'Deposit' AND "status" IN ('Completed', 'Success') AND "category" IS NULL;
  SELECT count(*) INTO v_request FROM "transactions"
   WHERE "type" = 'Deposit' AND "status" IN ('Completed', 'Success') AND "category" = 'Deposit Request';

  UPDATE "transactions"
     SET "category" = 'Deposit'
   WHERE "type" = 'Deposit'
     AND "status" IN ('Completed', 'Success')
     AND ("category" IS NULL OR "category" = 'Deposit Request');

  RAISE NOTICE '0024_normalize_deposit_category: relabelled % settled deposit rows (NULL: %, settled-but-still-a-request: %)',
    v_null + v_request, v_null, v_request;
END $$;
