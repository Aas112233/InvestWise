-- 0031_project_code
-- Human reference codes for projects: PRJ-0001, PRJ-0002, ... per tenant,
-- the same discipline as member codes (MEM-XXXX). Until now a project was
-- identified only by its UUID (unreadable) and its free-text title (NOT
-- unique) — two clubs-projects called "Building A" were indistinguishable in
-- lists, pickers, receipts and the audit trail.
--
--   * ADDITIVE. The UUID stays the real key everywhere (ledger FKs untouched);
--     project_code is an immutable human label generated server-side.
--   * Backfill numbers existing projects per tenant in creation order, so
--     the club's first project becomes PRJ-0001. Ranks are computed across
--     ALL rows and only NULL codes are written, which makes re-runs both
--     idempotent and collision-free (a never-numbered row cannot steal a
--     number an existing code already holds).
--   * NULLS caveat: projects.tenant_id is nullable for pre-tenant legacy
--     rows, and Postgres unique indexes treat NULLs as distinct. Current
--     tenants all carry an id (multi-tenancy enforcement predates this), so
--     the practical guarantee holds; lib/project-code.ts documents the
--     generator's tenant scoping.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_code" varchar(20);

WITH ranked AS (
  SELECT id, project_code,
         row_number() OVER (
           PARTITION BY tenant_id
           ORDER BY COALESCE(created_at, CURRENT_TIMESTAMP), id
         ) AS rn
  FROM "projects"
)
UPDATE "projects" p
SET "project_code" = 'PRJ-' || lpad(r.rn::text, 4, '0')
FROM ranked r
WHERE p.id = r.id AND p."project_code" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "projects_tenant_code_key"
  ON "projects" ("tenant_id", "project_code");

DO $$
DECLARE
  v_total    integer;
  v_numbered integer;
  v_dupes    integer;
BEGIN
  SELECT count(*) INTO v_total    FROM "projects";
  SELECT count(*) INTO v_numbered FROM "projects" WHERE "project_code" IS NOT NULL;
  SELECT count(*) INTO v_dupes FROM (
    SELECT tenant_id, "project_code"
    FROM "projects"
    WHERE "project_code" IS NOT NULL
    GROUP BY tenant_id, "project_code"
    HAVING count(*) > 1
  ) d;

  RAISE NOTICE '0031_project_code: % project(s), % numbered (expect equal), % duplicate (tenant,code) group(s) (expect 0)',
    v_total, v_numbered, v_dupes;
END $$;
