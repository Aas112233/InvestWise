-- 0012_transactions_type_vocabulary.sql
--
-- The app writes several ledger `type` values that the original
-- `transactions_type_check` never listed, so every such write failed the
-- constraint with 23514 — and each failure surfaced as a generic
-- CHECK_VIOLATION / a 500 echoing the full SQL:
--
--   * 'Transfer In' / 'Transfer Out'  — the two legs of an inter-fund transfer
--     (server/src/modules/finance/service.ts lines ~1480 / ~1501). Every fund
--     transfer was rejected, so transfers never landed (report issue 19).
--   * 'Statutory Reserve'             — the reserve leg of a dividend run
--     (app/api/dividends/distribute/route.ts ~line 200).
--   * 'Dividend Distribution'         — the run-level dividend row (same file,
--     ~line 220). Both broke every dividend run (report issue 20).
--   * 'Disbursement'                  — read by the transactions inflow/outflow
--     classifier (app/api/transactions/route.ts line 19) for legacy rows.
--   * 'Project Investment'            — the per-shareholder equity leg written
--     when a project is created with shareholders
--     (app/api/projects/route.ts line 311), and read back by the report ledger
--     vocabulary (lib/reports/data.ts line 106). Without it every project
--     created with a shareholder rolled back (report issue 73).
--
-- All of these are read back by reporting/aggregation code (finance/service.ts
-- lines 1907-1908, transactions/route.ts lines 18-19, fiscal close lines
-- 128-129), so they are an intentional vocabulary — the constraint was simply
-- never widened to match. This makes the DB CHECK the union of every value the
-- application actually writes or reads. Idempotent.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type::text = ANY (ARRAY[
    'Deposit'::character varying,
    'Withdrawal'::character varying,
    'Investment'::character varying,
    'Project Investment'::character varying,
    'Expense'::character varying,
    'Earning'::character varying,
    'Dividend'::character varying,
    'Equity-Transfer'::character varying,
    'Adjustment'::character varying,
    'Transfer'::character varying,
    'Transfer In'::character varying,
    'Transfer Out'::character varying,
    'Statutory Reserve'::character varying,
    'Dividend Distribution'::character varying,
    'Disbursement'::character varying
  ]::text[]));
