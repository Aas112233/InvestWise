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
    } catch (err) {
      console.error(
        "[DB] Boot connection or column verification notice:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
