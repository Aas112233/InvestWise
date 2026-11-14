-- 0033_tenant_categories
-- Tenant-configurable category vocabularies (Settings → Governance).
--
-- Why: "category" was hardcoded twice in the client with no server
-- counterpart — expense categories in components/expenses/{expense-modal,
-- expenses-view}.tsx (7 literals, duplicated verbatim) and project sectors in
-- components/projects/project-form-modal.tsx (6 literals). Both underlying
-- columns are plain free text (transactions.category varchar(100),
-- projects.category varchar(255)), so the hardcoded arrays were purely
-- decorative: the API accepted any string the caller sent, and an org could
-- not add, rename or retire a category without a code change.
--
-- Same shape and same precedent as 0008_tenant_payment_methods: the
-- vocabulary is per-tenant *data* on system_settings, and the write routes
-- validate against it (lib/categories.ts + lib/categories-db.ts).
--
-- Re-runnable: IF NOT EXISTS guarded. Defaults mirror
-- DEFAULT_EXPENSE_CATEGORIES / DEFAULT_PROJECT_CATEGORIES.

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "expense_categories" jsonb
  DEFAULT '["Operations","Project Expense","Governance Fine","Marketing","Legal","Travel","Technology","Maintenance","Other"]'::jsonb;

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "project_categories" jsonb
  DEFAULT '["Real Estate","Agriculture","Technology","Retail","Manufacturing","Other"]'::jsonb;

COMMENT ON COLUMN "system_settings"."expense_categories" IS
  'Tenant-configured expense categories: string[] — the expense form lists these and expense writes validate against them.';

COMMENT ON COLUMN "system_settings"."project_categories" IS
  'Tenant-configured project sectors: string[] — the project form lists these and project writes validate against them.';
