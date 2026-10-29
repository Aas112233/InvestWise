// Next.js server boot hook: warm up the Postgres pool once per server
// instance (instrumentation is on by default since Next.js 15).
// This is best-effort only — route handlers must NOT rely on it, because
// instrumentation runs in a separate module scope. getDb() in @/db/index
// lazily creates the pool on first call, so every route self-connects.
// A failed boot connection is logged, not fatal; connectDB() retries.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { connectDB, getSql } = await import("@/db/index");
      await connectDB();

      // Schema DDL is DEV-ONLY. In production the schema must be owned by the
      // checked-in migrations (scripts/migrate.mjs + db/migrations/*.sql),
      // never by a boot hook that runs on every cold start: a serverless
      // platform cold-starts many instances concurrently, the statements below
      // are not wrapped in a transaction, and a DROP CONSTRAINT loop racing an
      // active query can take locks on a live table. Migrations are the single
      // source of schema truth outside development.
      if (process.env.NODE_ENV === "production") {
        return;
      }

      const sql = getSql();
      await sql`
        ALTER TABLE "system_settings"
          ADD COLUMN IF NOT EXISTS "late_deposit_grace_months" integer DEFAULT 1,
          ADD COLUMN IF NOT EXISTS "inactive_after_months"     integer DEFAULT 3,
          ADD COLUMN IF NOT EXISTS "suspended_after_months"    integer DEFAULT 6;
      `;
      await sql`
        ALTER TABLE "transactions"
          ADD COLUMN IF NOT EXISTS "deposit_month" varchar(7);
      `;
      // Member directory identity + soft delete (see db/migrations/0007). Boot
      // DDL mirrors the migration so `next dev` — which does not run
      // migrations — has the columns Drizzle reads, and drops the legacy
      // GLOBAL uniques so a second tenant can register an email that exists
      // in another tenant. Every statement is idempotent / IF NOT EXISTS.
      await sql`
        ALTER TABLE "members"
          ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS "deleted_by" uuid,
          ADD COLUMN IF NOT EXISTS "deletion_reason" varchar(500),
          ADD COLUMN IF NOT EXISTS "status_reason" varchar(50);
      `;
      await sql.unsafe(`
        DO $$
        DECLARE r RECORD;
        BEGIN
          FOR r IN
            SELECT c.conname FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.conrelid = 'members'::regclass AND c.contype = 'u'
              AND array_length(c.conkey, 1) = 1 AND a.attname IN ('email', 'member_id')
          LOOP
            EXECUTE format('ALTER TABLE members DROP CONSTRAINT %I', r.conname);
          END LOOP;
        END $$;
      `);
      // Multi-statement blocks MUST go through sql.unsafe (simple-query
      // protocol): tagged templates are prepared statements, and Postgres
      // rejects "cannot insert multiple commands into a prepared statement".
      await sql.unsafe(`
        DROP INDEX IF EXISTS "members_email_unique";
        DROP INDEX IF EXISTS "members_member_id_unique";
      `);
      await sql.unsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "uq_members_tenant_member_id" ON "members" USING btree ("tenant_id","member_id");
        DROP INDEX IF EXISTS "uq_members_tenant_email";
        CREATE UNIQUE INDEX IF NOT EXISTS "uq_members_tenant_email" ON "members" USING btree ("tenant_id","email") WHERE "is_deleted" = false;
        CREATE INDEX IF NOT EXISTS "idx_members_tenant_is_deleted" ON "members" USING btree ("tenant_id","is_deleted");
      `);
      // Tenant-configurable payment methods (see db/migrations/0008): the
      // settings column plus removal of the fixed deposit-method CHECK — a
      // constraint can never track per-tenant data, and it 500'd every
      // deposit-request insert. Idempotent; server routes validate instead.
      await sql`
        ALTER TABLE "system_settings"
          ADD COLUMN IF NOT EXISTS "payment_methods" jsonb
          DEFAULT '[{"name":"Cash","type":"CASH"},{"name":"Bank Transfer","type":"BANK"},{"name":"bKash","type":"MOBILE"},{"name":"Nagad","type":"MOBILE"},{"name":"Rocket","type":"MOBILE"},{"name":"Check","type":"CHECK"},{"name":"Other","type":"OTHER"}]'::jsonb;
      `;
      await sql`ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_deposit_method_check"`;
      // doc_number (migration 0026) is intentionally NOT mirrored here. The boot
      // DDL above only patches columns; 0026 also defines four functions and a
      // BEFORE INSERT trigger, and duplicating that would put a second copy of
      // the numbering rules somewhere it can drift from db/migrations/ — the
      // failure being dev and prod issuing different references for the same
      // ledger position. `next dev` therefore needs the migration, like every
      // other migration this file does not reproduce. Warn loudly instead of
      // letting a receipt silently print a fallback.
      const docNumberReady = await sql`
        SELECT count(*)::int AS n FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'app_next_doc_number'
      `;
      if (docNumberReady[0]?.n === 0) {
        console.warn(
          "[DB] transactions.doc_number is not wired up: migration 0026_doc_number " +
            "has not been applied. Ledger references will fall back to the internal " +
            "reference number. Run: npm run db:migrate",
        );
      }
    } catch (err) {
      console.error(
        "[DB] Boot connection or column verification notice:",
        err instanceof Error ? err.message : err,
      );
      // In dev, a failed schema check is a notice (the lazy pool retries). In
      // production a failure to reach the database at boot must be loud so the
      // deploy is not silently serving errors.
      if (process.env.NODE_ENV === "production") {
        throw err;
      }
    }
  }
}
