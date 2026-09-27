import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const poolOptions = {
  max: 10,
  idle_timeout: 4,
  connect_timeout: 10,
  max_lifetime: 60 * 3,
  prepare: false,
  fetch_types: false,
  debug: false,
  onnotice: () => {},
};

/**
 * Opt-in query timing (DB_LOG_TIMING=1). Logs wall-clock duration of each
 * statement plus the client-side bytes, so a remote-database latency floor
 * is visible at a glance. Sustained 200-300ms per trivial query means the
 * database region — not the SQL — is the bottleneck.
 */
const logTiming = process.env.DB_LOG_TIMING === '1';

function makeOptions() {
  if (!logTiming) return poolOptions;
  return {
    ...poolOptions,
    onquery: (query: { string?: string; duration?: number }) => {
      const preview = (query.string || '').replace(/\s+/g, ' ').slice(0, 90);
      console.log(`[DB] ${query.duration?.toFixed(0) ?? '?'}ms  ${preview}`);
    },
  };
}

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

export async function connectDB(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  if (db && sql) return db;

  const connectionString = getDatabaseUrl();
  const maxAttempts = 5;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      sql = postgres(connectionString, makeOptions());
      db = drizzle(sql, { schema });

      await sql`SELECT 1`;
      
      console.log('[OK] PostgreSQL connected');
      return db;
    } catch (error) {
      console.error(`[ERROR] Connection attempt ${attempt}/${maxAttempts} failed:`, error);
      
      if (sql) {
        try {
          await sql.end();
        } catch {
          // Ignore error during closing failed connection
        }
        sql = null;
        db = null;
      }

      if (attempt === maxAttempts) {
        throw new Error(`Failed to connect to database after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }

      console.log(`Retrying database connection in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Database connection failed');
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    // Lazy singleton: instrumentation runs in a separate module scope from
    // route handlers, so its eager boot connection is invisible here.
    // Same serverless-safe pattern as server/src/lib/db.ts — postgres
    // connects on demand, and creation is synchronous so there is no race.
    sql = postgres(getDatabaseUrl(), makeOptions());
    db = drizzle(sql, { schema });
  }
  return db;
}

export function getSql(): ReturnType<typeof postgres> {
  if (!sql) getDb();
  return sql!;
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    if (!sql) return false;
    const result = await sql`SELECT 1 AS ok`;
    return result.length > 0;
  } catch {
    return false;
  }
}

export async function setAppContext(userId: string | null, role: string | null): Promise<void> {
  if (!sql) return;
  try {
    const targetUserId = userId || '';
    const targetRole = role || 'Member';
    await sql`SELECT set_config('app.user_id', ${targetUserId}, true), set_config('app.role', ${targetRole}, true)`;
  } catch (error) {
    console.error('Failed to set RLS app context:', error);
  }
}

export async function resetAppContext(): Promise<void> {
  if (!sql) return;
  try {
    await sql`SELECT set_config('app.user_id', '', true), set_config('app.role', '', true)`;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'CONNECTION_ENDED') return;
    console.error('Failed to reset RLS app context:', error);
  }
}

export { schema };