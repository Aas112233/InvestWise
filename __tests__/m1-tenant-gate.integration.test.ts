import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M1 — a tenant user whose `tenants` row is missing must be rejected, not
 * silently authenticated with every tenant policy gate skipped.
 *
 * `authenticateRequest` (lib/middleware/auth.ts) used to read the tenant row
 * under `if (tenantRow) { ... }` with no `else`. The suspended / maintenance /
 * module-entitlement gates all live inside that block, so a deleted or drifted
 * tenant row meant the request proceeded as authenticated with `tenant: null`
 * — every policy gate bypassed. The server stack already failed closed here
 * (`requireTenant` → 403 TENANT_REQUIRED); the modern stack did not.
 *
 * This test drives the real code path against a real Postgres:
 *   real JWT (signed with the app's own secret) → real `sessions` row →
 *   real `users` row → real `tenants` row.
 *
 * Reachability note (found by running this against Postgres 17.11): the
 * `users.tenant_id` foreign key is a plain FK with no ON DELETE action, so
 * Postgres *blocks* deleting a tenant while any user references it (23503).
 * A user whose tenant_id points nowhere therefore cannot be created by any
 * normal write — the M1 branch is defence-in-depth against drifted/restored
 * data, not a state the application can currently produce. That is why the
 * fail-closed case below is exercised through `tenantRows` being empty rather
 * than through a hand-made orphan row: the FK would reject the orphan.
 *
 * It runs only when DATABASE_URL_TEST is set, so a plain `npm test` on a
 * machine without a database stays green. It is skipped — never silently
 * passed — when the variable is absent.
 *
 *   DATABASE_URL_TEST=postgresql://... npx vitest run __tests__/m1-tenant-gate.integration.test.ts
 */

const CONNECTION = process.env.DATABASE_URL_TEST;

// jwt.ts requires a secret of at least 32 chars; set one before importing it.
// The app's own `getDb()` reads DATABASE_URL (db/index.ts), so point it at the
// test database too — the test must drive the real pool, not a parallel one.
if (CONNECTION) {
  process.env.DATABASE_URL = CONNECTION;
  process.env.JWT_SECRET ||= 'integration-test-secret-key-at-least-32-chars';
  process.env.JWT_REFRESH_SECRET ||= 'integration-test-refresh-secret-at-least-32ch';
}

describe.skipIf(!CONNECTION)('M1: missing tenant row fails closed', () => {
  let sql: postgres.Sql;
  let authenticateRequest: typeof import('@/lib/middleware/auth').authenticateRequest;
  let generateAccessToken: typeof import('@/lib/utils/jwt').generateAccessToken;

  // Ids created by this suite, cleaned up in afterAll.
  const createdUsers: string[] = [];
  const createdSessions: string[] = [];
  const createdTenants: string[] = [];

  beforeAll(async () => {
    sql = postgres(CONNECTION as string, { max: 2, connect_timeout: 10, prepare: false });
    // Import AFTER the env is primed so jwt.ts reads the test secret.
    ({ authenticateRequest } = await import('@/lib/middleware/auth'));
    ({ generateAccessToken } = await import('@/lib/utils/jwt'));
  });

  afterAll(async () => {
    if (!sql) return;
    // Order matters: sessions reference users; users reference tenants. A user
    // left pointing at a deleted tenant also has to go before any tenant
    // cleanup, so users are deleted first while the FK is still satisfied by
    // absence of conflict (deleting the child never trips the parent FK).
    if (createdSessions.length) {
      await sql`delete from sessions where session_id in ${sql(createdSessions)}`;
    }
    if (createdUsers.length) {
      await sql`delete from users where id in ${sql(createdUsers)}`;
    }
    if (createdTenants.length) {
      await sql`delete from tenants where id in ${sql(createdTenants)}`;
    }
    await sql.end();
  });

  /** Insert a user + active session and return a signed access token for it. */
  async function seedSession(opts: { tenantId: string | null; role?: string }): Promise<{ token: string; userId: string }> {
    const [user] = await sql`
      insert into users (name, email, password, role, status, permissions, tenant_id)
      values (${'M1 Test User'}, ${`m1-${randomUUID()}@test.invalid`}, ${'not-a-real-hash'}, ${opts.role ?? 'Manager'}, ${'active'}, ${sql.json({})}, ${opts.tenantId})
      returning id`;
    createdUsers.push(user.id);

    const sessionId = `m1-${randomUUID()}`;
    await sql`
      insert into sessions (user_id, session_id, ip_address, user_agent, login_time, last_activity, is_active, is_expired)
      values (${user.id}, ${sessionId}, ${'127.0.0.1'}, ${'vitest'}, now(), now(), true, false)`;
    createdSessions.push(sessionId);

    const token = generateAccessToken(user.id, { sessionId });
    return { token, userId: user.id };
  }

  function requestFor(token: string, path = '/api/members'): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it('rejects a user whose tenant row does not exist with 403 TENANT_REQUIRED', async () => {
    // The FK forbids an orphan user row outright (see the file header), so the
    // reachable way to hit the fail-closed branch is a user with a tenantId
    // whose tenant row is absent from the lookup. Drive that by creating a
    // real tenant + user, then removing the tenant row *and* the FK in one
    // transaction so the drift state exists exactly as a restore would leave
    // it — then read through the same code path the app uses.
    const [tenant] = await sql`
      insert into tenants (slug, name, status, is_maintenance_mode)
      values (${`m1-orphan-${randomUUID()}`}, ${'M1 Orphan Tenant'}, ${'active'}, false)
      returning id`;
    createdTenants.push(tenant.id);

    const { token, userId } = await seedSession({ tenantId: tenant.id });

    // Prove the credential is good while the tenant exists.
    const before = await authenticateRequest(requestFor(token));
    expect(before.error, 'precondition: the token must authenticate normally').toBeUndefined();
    expect(before.tenant?.id).toBe(tenant.id);

    // Now recreate the drifted-data state: drop the referencing user's tenant
    // link from the tenants side while leaving users.tenant_id intact. The FK
    // blocks every normal route to this state (plain DELETE → 23503, and it is
    // not deferrable), which is exactly why the application cannot create it.
    // Drift arrives by other means — a partial restore, a replication gap, a
    // manual platform-side delete — so simulate it the same way: remove the
    // guard, delete the row, put the guard back.
    //
    // The guard is removed and restored in a `finally` so a failed assertion
    // can never leave the developer's database without its foreign key.
    await sql.unsafe('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_tenants_id_fk');
    try {
      await sql`delete from tenants where id = ${tenant.id}`;
      const [stillThere] = await sql`select id from tenants where id = ${tenant.id}`;
      expect(stillThere, 'precondition: the tenant row must now be gone').toBeUndefined();
      const [userRow] = await sql`select tenant_id from users where id = ${userId}`;
      expect(userRow.tenant_id, 'precondition: user must still point at the missing tenant').toBe(tenant.id);

      // The identity cache is keyed by sha256(token) and serves the pre-drift
      // snapshot for up to AUTH_CACHE_TTL_MS (10s). Re-minting a token for the
      // same user+session inside the same second produces byte-identical JWTs,
      // i.e. the same cache key. Minting a fresh session id is what actually
      // forces a cache miss — and a real drifted deployment would be handing
      // out its own distinct tokens anyway.
      const freshSessionId = `m1-${randomUUID()}`;
      await sql`
        insert into sessions (user_id, session_id, ip_address, user_agent, login_time, last_activity, is_active, is_expired)
        values (${userId}, ${freshSessionId}, ${'127.0.0.1'}, ${'vitest'}, now(), now(), true, false)`;
      createdSessions.push(freshSessionId);
      const freshToken = generateAccessToken(userId, { sessionId: freshSessionId });
      const result = await authenticateRequest(requestFor(freshToken));

      expect(result.error, 'a missing tenant row must not authenticate').toBeDefined();
      expect(result.error?.status).toBe(403);
      expect(result.user).toBeNull();
      expect(result.tenant).toBeNull();

      const body = await result.error!.json();
      expect(body.code).toBe('TENANT_REQUIRED');
    } finally {
      // Reap the orphaned user BEFORE the FK is restored, otherwise the ADD
      // CONSTRAINT fails on the very row this test just manufactured.
      await sql`delete from users where id = ${userId}`;
      const orphanIdx = createdUsers.indexOf(userId);
      if (orphanIdx !== -1) createdUsers.splice(orphanIdx, 1);

      const [{ n }] = await sql`
        select count(*)::int n from pg_constraint where conname = 'users_tenant_id_tenants_id_fk'`;
      if (n === 0) {
        await sql.unsafe(
          'ALTER TABLE users ADD CONSTRAINT users_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)',
        );
      }
    }
  });

  it('still authenticates a user whose tenant row exists and is active', async () => {
    // Control case: proves the fail-closed branch is specific to a missing row
    // and did not simply reject every tenant user.
    const [tenant] = await sql`
      insert into tenants (slug, name, status, is_maintenance_mode)
      values (${`m1-${randomUUID()}`}, ${'M1 Test Tenant'}, ${'active'}, false)
      returning id`;
    createdTenants.push(tenant.id);

    const { token, userId } = await seedSession({ tenantId: tenant.id });
    const result = await authenticateRequest(requestFor(token));

    expect(result.error).toBeUndefined();
    expect(result.user?.id).toBe(userId);
    expect(result.tenant?.id).toBe(tenant.id);
  });

  it('rejects a suspended tenant with 403 TENANT_SUSPENDED', async () => {
    // The gate this suite protects: it lives in the same block that a missing
    // tenant row used to skip entirely.
    const [tenant] = await sql`
      insert into tenants (slug, name, status, is_maintenance_mode)
      values (${`m1-${randomUUID()}`}, ${'M1 Suspended Tenant'}, ${'suspended'}, false)
      returning id`;
    createdTenants.push(tenant.id);

    const { token } = await seedSession({ tenantId: tenant.id });
    const result = await authenticateRequest(requestFor(token));

    expect(result.error?.status).toBe(403);
    expect((await result.error!.json()).code).toBe('TENANT_SUSPENDED');
    expect(result.user).toBeNull();
  });
});
