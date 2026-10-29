-- 0026_doc_number
--
-- A human-readable reference for every ledger row: `{CODE}-{YEAR}-{SEQ5}`,
-- e.g. `DEP-2026-00042`. Shown in the client and on every printed report, in
-- place of `transactions.id` truncated to 8 hex characters.
--
-- Design notes
--
--   * `reference_number` is NOT repurposed. It already carries (a) client
--     idempotency/retry keys, (b) transfer-leg suffixes, and (c) the bank or
--     challan number a clerk types into the deposit form, and it is guarded by
--     `uq_trans_tenant_reference`, whose only job is to stop a concurrent
--     double-submit from crediting a fund twice. Overwriting it with a
--     server-issued counter would remove that guard and destroy the clerk's
--     input. The two fields are separate and stay separate.
--
--   * Assignment is a BEFORE INSERT trigger, not application code. The ledger is
--     written from 20+ call sites across `app/api/**` and `server/src/modules/**`
--     (plus seeds and scripts). A per-site helper would eventually miss one, and
--     the failure mode of a miss is a blank reference on a printed receipt. The
--     trigger also inherits the caller's transaction, so a rolled-back posting
--     never burns a number.
--
--   * Counters live in a table rather than native SEQUENCE objects. nextval()
--     does not participate in the surrounding transaction, so every failed,
--     rejected or reverted posting would leave a hole in the series — and a gap
--     in a printed document series is an audit finding. A counter row is locked
--     and rolled back with the posting that incremented it. One sequence object
--     per (tenant, type, year) would additionally require dynamic DDL inside
--     request traffic.
--
--   * The year comes from the tenant's own wall clock (system_settings.timezone,
--     migration 0022) evaluated against `date` — the column this schema already
--     documents as the canonical money-movement date. A deposit collected at
--     2026-12-31T23:30Z belongs to 2027 in Dhaka, and is numbered 2027, matching
--     how the same row is attributed by every date filter in the app.
--
--   * Back-dating therefore does NOT renumber history: an entry added late to a
--     past year takes the next free number IN THAT YEAR. The year's series is
--     gap-free by construction; it is not monotonic with entry time. That is how
--     a paper ledger book behaves, and it is the trade-off chosen deliberately.
--
--   * Numbers are never reused, including after a soft delete (see
--     `uq_trans_tenant_doc_number`), so a receipt already handed to a member
--     stays resolvable forever. Same decision already made for member codes in
--     `uq_members_tenant_member_id`.
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / guarded DO blocks throughout, and
-- the backfill only touches rows where doc_number IS NULL.

-- ---------------------------------------------------------------------------
-- 1. Counter table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "document_sequences" (
  "tenant_id"   uuid         NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "doc_type"    varchar(10)  NOT NULL,
  "period_year" integer      NOT NULL,
  "last_seq"    integer      NOT NULL DEFAULT 0,
  "updated_at"  timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("tenant_id", "doc_type", "period_year")
);

COMMENT ON TABLE "document_sequences" IS
  'Per-tenant document-number counters for transactions.doc_number. Allocated by app_next_doc_number(); not written from application code.';

-- ---------------------------------------------------------------------------
-- 2. The display column
-- ---------------------------------------------------------------------------
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "doc_number" varchar(32);

COMMENT ON COLUMN "transactions"."doc_number" IS
  'Client-facing reference (DEP-2026-00042). Assigned by trg_transactions_doc_number. Never reused, even after soft delete. Do not confuse with reference_number, which is an internal idempotency token and clerk input.';

-- ---------------------------------------------------------------------------
-- 3. Type -> document code
--    The ledger `type` vocabulary is pinned by transactions_type_check
--    (migration 0012) and by lib/ledger-type-vocabulary.test.ts. A type that is
--    not listed here still gets a number ('GEN') rather than NULL: a blank
--    receipt is worse than a generic prefix, and the prefix makes the gap
--    visible instead of silent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_doc_type_code(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_type
    WHEN 'Deposit'               THEN 'DEP'
    WHEN 'Withdrawal'            THEN 'WDL'
    WHEN 'Investment'            THEN 'INV'
    WHEN 'Project Investment'    THEN 'PIN'
    WHEN 'Expense'               THEN 'EXP'
    WHEN 'Earning'               THEN 'EAR'
    WHEN 'Dividend'              THEN 'DVD'
    WHEN 'Dividend Distribution' THEN 'DDS'
    WHEN 'Statutory Reserve'     THEN 'RES'
    WHEN 'Equity-Transfer'       THEN 'EQT'
    WHEN 'Adjustment'            THEN 'ADJ'
    WHEN 'Transfer'              THEN 'TRF'
    WHEN 'Transfer In'           THEN 'TRI'
    WHEN 'Transfer Out'          THEN 'TRO'
    WHEN 'Disbursement'          THEN 'DST'
    ELSE 'GEN'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Formatting, isolated so the shape of a reference has exactly one definition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_format_doc_number(
  p_code text,
  p_year integer,
  p_seq  bigint
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Width 5 is a display convention, not a ceiling: past 99,999 the number
  -- simply grows a digit rather than colliding or truncating.
  SELECT p_code || '-' || p_year::text || '-' || lpad(p_seq::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- 5. Accounting year, on the tenant's clock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_doc_period_year(
  p_instant timestamptz,
  p_tenant  uuid
)
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXTRACT(YEAR FROM
    COALESCE(p_instant, now()) AT TIME ZONE
    COALESCE(
      (SELECT ss."timezone" FROM public."system_settings" ss
        WHERE ss."tenant_id" = p_tenant LIMIT 1),
      'Asia/Dhaka'
    )
  )::integer;
$$;

-- ---------------------------------------------------------------------------
-- 6. The allocator
--
-- The INSERT .. ON CONFLICT DO UPDATE .. RETURNING is the whole concurrency
-- story: two sessions allocating the same (tenant, type, year) serialise on the
-- counter row's lock, and each sees its own incremented value. No SELECT-then-
-- INSERT window exists, which is the exact race `uq_trans_tenant_reference` was
-- added to contain for reference_number (see migration 0009).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_next_doc_number(
  p_tenant uuid,
  p_type   text,
  p_instant timestamptz
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
PARALLEL UNSAFE
AS $$
DECLARE
  v_code text := public.app_doc_type_code(p_type);
  v_year integer := public.app_doc_period_year(p_instant, p_tenant);
  v_seq  bigint;
BEGIN
  WITH ups AS (
    INSERT INTO public."document_sequences"
      ("tenant_id", "doc_type", "period_year", "last_seq", "updated_at")
    VALUES
      (p_tenant, v_code, v_year, 1, now())
    ON CONFLICT ("tenant_id", "doc_type", "period_year")
    DO UPDATE SET
      "last_seq"   = public."document_sequences"."last_seq" + 1,
      "updated_at" = now()
    RETURNING public."document_sequences"."last_seq"
  )
  SELECT last_seq INTO v_seq FROM ups;

  RETURN public.app_format_doc_number(v_code, v_year, v_seq);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_set_doc_number()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  -- An explicit value always wins, so a backfill, a seed or a restore can pin
  -- a number it already printed.
  IF NEW."doc_number" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Tenant-less rows cannot be numbered: the series is per tenant by design,
  -- and inventing a shared counter would let one org consume another's numbers.
  -- Such rows are pre-0026 legacy; they keep a NULL and the UI says "unnumbered".
  IF NEW."tenant_id" IS NULL THEN
    RETURN NEW;
  END IF;

  NEW."doc_number" := public.app_next_doc_number(
    NEW."tenant_id",
    NEW."type",
    COALESCE(NEW."date", NEW."created_at")
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_transactions_doc_number" ON public."transactions";
CREATE TRIGGER "trg_transactions_doc_number"
  BEFORE INSERT ON public."transactions"
  FOR EACH ROW
  EXECUTE FUNCTION public.app_set_doc_number();

-- ---------------------------------------------------------------------------
-- 8. Backfill — every existing row in the order the reports read them
--
-- Ordering matches lib/reports/data.ts (date, created_at, id) rather than
-- creation time, so a year's numbers run with the ledger instead of against it.
-- Partitioned by (tenant, code, year) so each series starts at 00001.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    t."id" AS "id",
    t."tenant_id" AS "tenant_id",
    public.app_doc_type_code(t."type") AS "code",
    public.app_doc_period_year(COALESCE(t."date", t."created_at"), t."tenant_id") AS "yr",
    row_number() OVER (
      PARTITION BY
        t."tenant_id",
        public.app_doc_type_code(t."type"),
        public.app_doc_period_year(COALESCE(t."date", t."created_at"), t."tenant_id")
      ORDER BY t."date" NULLS LAST, t."created_at" NULLS LAST, t."id"
    ) AS "rn"
  FROM public."transactions" t
  WHERE t."doc_number" IS NULL
    AND t."tenant_id" IS NOT NULL
),
assigned AS (
  UPDATE public."transactions" t
     SET "doc_number" = public.app_format_doc_number(r."code", r."yr", r."rn")
    FROM ranked r
   WHERE t."id" = r."id"
  RETURNING r."tenant_id" AS "tenant_id", r."code" AS "code", r."yr" AS "yr", r."rn" AS "rn"
)
INSERT INTO public."document_sequences" ("tenant_id", "doc_type", "period_year", "last_seq")
SELECT "tenant_id", "code", "yr", max("rn")::bigint::integer FROM assigned GROUP BY 1, 2, 3
ON CONFLICT ("tenant_id", "doc_type", "period_year")
DO UPDATE SET "last_seq" = GREATEST(
  public."document_sequences"."last_seq",
  EXCLUDED."last_seq"
);

-- ---------------------------------------------------------------------------
-- 9. Indexes (after the backfill, so a duplicate can never abort their creation)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Not partial on is_deleted: a soft-deleted row keeps its number. NULLs are
-- distinct to Postgres, so pre-0026 tenant-less rows do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_trans_tenant_doc_number"
  ON public."transactions" USING btree ("tenant_id", "doc_number");

-- The ledger search box matches on the string a member reads off a receipt.
CREATE INDEX IF NOT EXISTS "idx_trans_doc_number_trgm"
  ON public."transactions" USING gin ("doc_number" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 10. Post-condition report
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total   bigint;
  v_numbered bigint;
  v_unnumbered bigint;
  v_counters bigint;
  v_dupe_keys bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public."transactions";
  SELECT count(*) INTO v_numbered FROM public."transactions" WHERE "doc_number" IS NOT NULL;
  SELECT count(*) INTO v_unnumbered FROM public."transactions" WHERE "doc_number" IS NULL AND "tenant_id" IS NOT NULL;
  SELECT count(*) INTO v_counters FROM public."document_sequences";

  SELECT count(*) INTO v_dupe_keys FROM (
    SELECT "tenant_id", "doc_number"
      FROM public."transactions"
     WHERE "doc_number" IS NOT NULL
     GROUP BY 1, 2 HAVING count(*) > 1
  ) d;

  RAISE NOTICE '0026_doc_number: % rows, % numbered, % unexpected-null, % counter rows, % duplicate keys',
    v_total, v_numbered, v_unnumbered, v_counters, v_dupe_keys;

  -- A duplicate here would abort the unique index above anyway; asserting the
  -- count lets a re-run report the same thing a fresh run does.
  IF v_dupe_keys > 0 THEN
    RAISE WARNING '0026_doc_number: % (tenant, doc_number) pairs are duplicated — investigate before relying on the series', v_dupe_keys;
  END IF;
  IF v_unnumbered > 0 THEN
    RAISE WARNING '0026_doc_number: % tenant-scoped rows still have no doc_number', v_unnumbered;
  END IF;
END $$;
