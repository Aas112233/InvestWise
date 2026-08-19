import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env, isServerless } from '../config/env.js';
import * as schema from '../db/schema/index.js';

const poolOptions = {
  max: 15,              // Optimal concurrent connection pool for Supabase PgBouncer pooler
  idle_timeout: 20,     // Close idle connections cleanly before Supabase server drops them
  connect_timeout: 30,  // 30s timeout allows sufficient headroom for international TLS handshakes
  max_lifetime: 60 * 15, // 15 min connection lifetime rotation
  prepare: false,       // Required for Supabase transaction-mode pooler (port 6543)
  debug: false,
};

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function connectDB(): Promise<typeof db> {
  if (db && sql) return db;

  const connectionString = env.DATABASE_URL;
  const maxAttempts = 5;
  const delayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      sql = postgres(connectionString, {
        ...poolOptions,
        onnotice: () => {},
      });

      db = drizzle(sql, { schema });

      await sql`SELECT 1`;
      
      // Auto-migrate critical schema columns if needed
      try {
        await sql`ALTER TABLE global_stats_trends ADD COLUMN IF NOT EXISTS deposit numeric(15, 2) DEFAULT '0'`;
        await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS mother_name varchar(255)`;
        await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS spouse_name varchar(255)`;
      } catch {
        // Non-blocking if tables not yet created
      }

      console.log('[OK] PostgreSQL connected');
      return db;
    } catch (error) {
      console.error(`[ERROR] Connection attempt ${attempt}/${maxAttempts} failed:`, error);
      
      if (sql) {
        try {
          await sql.end();
        } catch (endError) {
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
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

export function getSql(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('Database not connected. Call connectDB() first.');
  return sql;
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
    // Batch set_config statements into a single database roundtrip to optimize latency
    await sql`SELECT set_config('app.user_id', ${targetUserId}, true), set_config('app.role', ${targetRole}, true)`;
  } catch (error) {
    console.error('Failed to set RLS app context:', error);
  }
}

/**
 * Explicitly reset RLS context — call this AFTER every response to ensure
 * no user/role state bleeds into the next request on a pooled connection.
 *
 * Silently ignores connection-closed errors (harmless at shutdown).
 */
export async function resetAppContext(): Promise<void> {
  if (!sql) return;
  try {
    await sql`SELECT set_config('app.user_id', '', true), set_config('app.role', '', true)`;
  } catch (error) {
    // Suppress shutdown-noise: CONNECTION_ENDED is expected when the pool closes
    const err = error as { code?: string };
    if (err.code === 'CONNECTION_ENDED') return;
    console.error('Failed to reset RLS app context:', error);
  }
}

export async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received. Shutting down...`);
  if (sql) {
    await sql.end();
    console.log('PostgreSQL connection closed');
  }
  process.exit(0);
}

if (!isServerless) {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export { db, sql };
