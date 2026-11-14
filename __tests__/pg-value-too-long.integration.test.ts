import { describe, it, expect, afterAll } from 'vitest';
import postgres from 'postgres';
import { normalizeError } from '@/server/src/shared/errors';

/**
 * Proof that an over-length value degrades to a 400 instead of a raw 500.
 *
 * Rationale: the DB ceiling (varchar(n)) is the only limit that ALWAYS applies,
 * but it rejects with Postgres 22001. Before this mapping existed, any route
 * that lacked its own length check (fund create, goals.description, and every
 * future route) surfaced 22001 as an uncaught 500. Rather than assert on a
 * hand-built error object, this drives a REAL Postgres overflow through the
 * REAL normalizeError, so the test fails if either the mapping is removed or
 * Postgres stops raising 22001.
 *
 * Skips (never silently passes) when no test database is configured.
 */
const CONNECTION = process.env.DATABASE_URL_TEST;

describe.skipIf(!CONNECTION)('Postgres value-too-long maps to a field error', () => {
  const sql = postgres(CONNECTION!, { max: 1, connect_timeout: 10, prepare: false });
  const TABLE = '__text_limit_probe';
  let tableCreated = false;

  afterAll(async () => {
    if (tableCreated) await sql.unsafe(`drop table if exists ${TABLE}`).catch(() => {});
    await sql.end();
  });

  it('turns a varchar(n) overflow into a 400 VALUE_TOO_LONG', async () => {
    // A throwaway table keeps this test independent of the real schema, which
    // migrations may reshape. Reap-then-restore: drop it in afterAll.
    await sql.unsafe(`drop table if exists ${TABLE}`);
    await sql.unsafe(`create table ${TABLE} (small varchar(10) not null)`);
    tableCreated = true;

    let caught: unknown;
    try {
      await sql.unsafe(`insert into ${TABLE} (small) values ('${'x'.repeat(50)}')`);
    } catch (err) {
      caught = err;
    }

    // Guard: the overflow must actually have been raised. A silently accepted
    // 50-char value would make the mapping assertion below vacuous.
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe('22001');

    const app = normalizeError(caught);
    expect(app.statusCode).toBe(400);
    expect(app.code).toBe('VALUE_TOO_LONG');
    // The message must be client-safe: no raw SQL, no column internals.
    expect(app.message).not.toMatch(/22001|character varying|insert into/i);
  });

  it('leaves unmapped SQLSTATEs as an internal error, so 22001 is a deliberate choice', () => {
    // Guards against someone "fixing" this by widening the default branch.
    const notMapped = Object.assign(new Error('boom'), { code: 'XX999' });
    expect(normalizeError(notMapped).statusCode).not.toBe(400);
  });
});
