import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env, isServerless } from '../config/env.js';
import * as schema from '../db/schema/index.js';

const poolOptions = {
  max: 25,              // More concurrent connections to reduce queue wait
  idle_timeout: 30,     // Keep idle connections alive (Supabase pooler drops at 60s)
  connect_timeout: 10,  // Fail fast on connection errors
  max_lifetime: 60 * 30, // 30 min — rotate connections to avoid stale state
  prepare: false,       // Required for Supabase transaction-mode pooler (port 6543)
  // Reduce protocol overhead — don't send notices to the client
  debug: false,
};

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function connectDB(): Promise<typeof db> {
  if (db && sql) return db;

  const connectionString = env.DATABASE_URL;
  sql = postgres(connectionString, {
    ...poolOptions,
    onnotice: () => {},
  });

  db = drizzle(sql, { schema });

  await sql`SELECT 1`;
  console.log('✓ PostgreSQL connected');
  return db;
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
