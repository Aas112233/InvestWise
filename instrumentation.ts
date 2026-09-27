// Next.js server boot hook: warm up the Postgres pool once per server
// instance (instrumentation is on by default since Next.js 15).
// This is best-effort only — route handlers must NOT rely on it, because
// instrumentation runs in a separate module scope. getDb() in @/db/index
// lazily creates the pool on first call, so every route self-connects.
// A failed boot connection is logged, not fatal; connectDB() retries.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { connectDB } = await import("@/db/index");
      await connectDB();
    } catch (err) {
      console.error(
        "[DB] Boot connection failed; will retry on demand:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
