import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import * as schema from './schema/index.js';

// Load environment variables
dotenv.config({ path: '.env' });

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

let isConnecting = false;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const isServerlessRuntime = Boolean(process.env.VERCEL);

// PostgreSQL connection pool options
const poolOptions = {
  max: 10,
  idle_timeout: 60,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // 30 minutes
};

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/**
 * Initialize or return existing database connection.
 * Uses retry logic matching the previous Mongoose connectDB pattern.
 */
const connectDB = async (retryCount = 0): Promise<ReturnType<typeof drizzle>> => {
  // Return existing connection if already connected
  if (db && sql) {
    return db;
  }

  if (isConnecting) {
    // Wait for connection to complete
    let waited = 0;
    while (isConnecting && waited < 30000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    if (db && sql) return db;
  }

  isConnecting = true;

  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL environment variable is not set. ' +
        'Please set it to your PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/dbname)'
      );
    }

    sql = postgres(connectionString, {
      ...poolOptions,
      onnotice: () => {}, // Suppress notice messages
    });

    db = drizzle(sql, { schema });

    // Verify connection with a simple health check
    await sql`SELECT 1`;

    console.log(` PostgreSQL Connected`);
    isConnecting = false;

    // Reset retry count on successful connection
    (connectDB as any).retryCount = 0;

    return db;
  } catch (error: any) {
    isConnecting = false;
    sql = null;
    db = null;
    console.error(
      ` PostgreSQL Connection Error (Attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`
    );

    // Store retry count on the function itself
    if (!(connectDB as any).retryCount) {
      (connectDB as any).retryCount = 0;
    }
    (connectDB as any).retryCount = retryCount + 1;

    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    // Calculate retry delay with exponential backoff
    const retryDelay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
      MAX_RETRY_DELAY
    );

    if (isServerlessRuntime) {
      console.warn(' Serverless runtime detected. Skipping background retry scheduling.');
      throw error;
    }

    // Don't exit process in development to allow server to stay up
    if (process.env.NODE_ENV === 'production' && retryCount >= MAX_RETRIES - 1) {
      console.error(' Max retries reached. Exiting process.');
      process.exit(1);
    }

    // Schedule retry
    console.log(` Retrying in ${retryDelay / 1000} seconds...`);
    reconnectTimeout = setTimeout(() => {
      connectDB((connectDB as any).retryCount);
    }, retryDelay);

    throw error;
  }
};

/**
 * Health check function — replaces mongoose.connection.readyState checks.
 * Returns true if the database is reachable.
 */
const checkDbHealth = async (): Promise<boolean> => {
  try {
    if (!sql) return false;
    const result = await sql`SELECT 1 AS ok`;
    return result.length > 0;
  } catch {
    return false;
  }
};

/**
 * Graceful shutdown handler — replaces mongoose.connection.close()
 */
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  try {
    if (sql) {
      await sql.end();
      console.log('PostgreSQL connection closed');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error closing PostgreSQL connection:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Get the Drizzle database instance (must call connectDB first).
 */
const getDb = (): ReturnType<typeof drizzle> => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
};

/**
 * Get the raw SQL client for health checks and raw queries.
 */
const getSql = (): ReturnType<typeof postgres> => {
  if (!sql) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return sql;
};

/**
 * Set application-level user context for RLS policies.
 * Must be called after JWT auth sets req.user.
 * Executes SET LOCAL so the context is scoped to this connection/session.
 */
const setAppContext = async (userId: string | null, role: string | null): Promise<void> => {
  const client = sql;
  if (!client) return; // No-op if DB not connected

  try {
    if (userId) {
      await client`SET LOCAL app.user_id = ${userId}`;
      await client`SET LOCAL app.role = ${role || 'Member'}`;
    } else {
      // Clear context for unauthenticated requests
      await client`SET LOCAL app.user_id = ''`;
      await client`SET LOCAL app.role = ''`;
    }
  } catch (error) {
    console.error('Failed to set RLS app context:', error);
    // Don't throw — let the request proceed; RLS will just block it
  }
};

export default connectDB;
export { db, sql, checkDbHealth, getDb, getSql, setAppContext };
export type { schema };
