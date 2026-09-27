import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema/index.js';

/**
 * Lazy singleton Postgres pool + Drizzle instance for the Next.js runtime.
 * Serverless-safe: no top-level connection, no connect-time DDL.
 * Supabase transaction-pooler settings mirrored from the Express API.
 */
const poolOptions = {
  max: 10,
  idle_timeout: 4,
  connect_timeout: 10,
  max_lifetime: 60 * 3,
  prepare: false, // required for Supabase transaction-mode pooler (port 6543)
  fetch_types: false,
};

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }
    sql = postgres(connectionString, { ...poolOptions, onnotice: () => {} });
    db = drizzle(sql, { schema });
  }
  return db;
}

export function getSql() {
  getDb();
  return sql!;
}

/** Close the pool explicitly (tests / graceful shutdown). */
export async function closeDb() {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}
