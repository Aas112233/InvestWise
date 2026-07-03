/**
 * TTL Cleanup Module
 * Replaces MongoDB TTL indexes with scheduled PostgreSQL cleanup jobs.
 *
 * MongoDB TTL indexes auto-delete expired documents. PostgreSQL doesn't have
 * native TTL indexes, so we use:
 * 1. pg_cron (Supabase extension) — preferred, runs in-database
 * 2. Node.js setInterval — fallback for non-Supabase environments
 *
 * Tables requiring periodic cleanup:
 * - sessions: DELETE rows where logout_time < now() - INTERVAL '30 days'
 * - blacklisted_tokens: DELETE rows where expires_at < now()
 * - login_attempts: DELETE rows where timestamp < now() - INTERVAL '90 days'
 */

import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// ─── pg_cron SQL setup ────────────────────────────────────────────────────────

/**
 * SQL to register pg_cron cleanup jobs on Supabase.
 * Run this once via the Supabase SQL Editor or a migration.
 */
export const PG_CRON_SETUP_SQL = `
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Clean up expired sessions (daily at 3:00 AM UTC)
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 3 * * *',
  $$DELETE FROM sessions WHERE logout_time IS NOT NULL AND logout_time < now() - INTERVAL '30 days'$$
);

-- Clean up expired blacklisted tokens (hourly)
SELECT cron.schedule(
  'cleanup-expired-tokens',
  '0 * * * *',
  $$DELETE FROM blacklisted_tokens WHERE expires_at < now()$$
);

-- Clean up old login attempts (daily at 3:30 AM UTC)
SELECT cron.schedule(
  'cleanup-old-login-attempts',
  '30 3 * * *',
  $$DELETE FROM login_attempts WHERE timestamp < now() - INTERVAL '90 days'$$
);
`;

// ─── Node.js fallback cleanup ─────────────────────────────────────────────────

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Run cleanup queries. Called periodically by the Node.js fallback.
 */
const runCleanup = async (sql: ReturnType<typeof postgres>) => {
  try {
    const results = await Promise.allSettled([
      sql`DELETE FROM sessions WHERE logout_time IS NOT NULL AND logout_time < now() - INTERVAL '30 days'`,
      sql`DELETE FROM blacklisted_tokens WHERE expires_at < now()`,
      sql`DELETE FROM login_attempts WHERE timestamp < now() - INTERVAL '90 days'`,
    ]);

    const [sessions, tokens, attempts] = results;

    let deletedCount = 0;
    if (sessions.status === 'fulfilled') deletedCount += sessions.value.count;
    if (tokens.status === 'fulfilled') deletedCount += tokens.value.count;
    if (attempts.status === 'fulfilled') deletedCount += attempts.value.count;

    if (deletedCount > 0) {
      console.log(` TTL Cleanup: removed ${deletedCount} expired rows`);
    }
  } catch (error) {
    console.error('TTL cleanup error:', error);
  }
};

/**
 * Start the Node.js fallback cleanup interval.
 * Only call this if pg_cron is NOT available (self-hosted PostgreSQL, etc.).
 * Safe to call multiple times — only one interval runs.
 */
export const startCleanupInterval = (connectionString: string, intervalMs = 60 * 60 * 1000) => {
  if (cleanupInterval) {
    console.warn('Cleanup interval already running. Skipping duplicate start.');
    return;
  }

  const sql = postgres(connectionString, { max: 1, idle_timeout: 30 });

  // Run once immediately
  runCleanup(sql);

  // Then run on schedule
  cleanupInterval = setInterval(() => runCleanup(sql), intervalMs);

  console.log(` TTL Cleanup: Node.js fallback running every ${intervalMs / 1000 / 60} minutes`);
};

/**
 * Stop the Node.js fallback cleanup interval.
 */
export const stopCleanupInterval = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log(' TTL Cleanup: stopped');
  }
};
