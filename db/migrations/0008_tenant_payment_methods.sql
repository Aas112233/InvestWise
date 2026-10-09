-- 0008_tenant_payment_methods
-- Tenant-configurable payment methods (Settings → Governance) and removal of
-- the fixed deposit-method CHECK constraint.
--
-- Why: the two deposit forms hardcoded DIFFERENT method vocabularies
-- ("Cash/Bank/Mobile Banking/Check/Other" vs "BANK_TRANSFER/BKASH/NAGAD/
-- ROCKET/CASH/OTHER") while the DB carried a CHECK constraint allowing only
-- the first. Every deposit-request insert therefore died on
-- transactions_deposit_method_check (23514) — a user-visible 500 on a core
-- flow. Payment methods are per-tenant *data* now (name + channel type, in
-- system_settings.payment_methods); a fixed CHECK can never track that, so it
-- is dropped and the write routes validate against the tenant's configured
-- list instead (lib/payment-methods.ts, isAllowedDepositMethod).
--
-- Re-runnable: IF NOT EXISTS / IF EXISTS guarded.

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "payment_methods" jsonb
  DEFAULT '[
    {"name":"Cash","type":"CASH"},
    {"name":"Bank Transfer","type":"BANK"},
    {"name":"bKash","type":"MOBILE"},
    {"name":"Nagad","type":"MOBILE"},
    {"name":"Rocket","type":"MOBILE"},
    {"name":"Check","type":"CHECK"},
    {"name":"Other","type":"OTHER"}
  ]'::jsonb;

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_deposit_method_check";

COMMENT ON COLUMN "system_settings"."payment_methods" IS
  'Tenant-configured payment methods: [{name, type}] — deposit forms list these and ledger writes validate against them.';
