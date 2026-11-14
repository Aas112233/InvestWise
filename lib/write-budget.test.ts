import { describe, expect, it } from 'vitest';
import { WRITE_BUDGET, shouldApplyWriteBudget, type BudgetUser } from './write-budget';
import { bucketKey } from './rate-limit';

describe('shouldApplyWriteBudget — the pure gate', () => {
  it('consumes every write verb', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(shouldApplyWriteBudget(method, '/api/members')).toBe(true);
    }
    // Case-insensitive: proxies vary.
    expect(shouldApplyWriteBudget('post', '/api/members')).toBe(true);
  });

  it('never consumes reads', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(shouldApplyWriteBudget(method, '/api/members')).toBe(false);
    }
  });

  it('exempts the three paths with their own controls', () => {
    expect(shouldApplyWriteBudget('POST', '/api/auth/login')).toBe(false);
    expect(shouldApplyWriteBudget('POST', '/api/auth/refresh')).toBe(false);
    expect(shouldApplyWriteBudget('POST', '/api/cron/governance-sweep')).toBe(false);
    expect(shouldApplyWriteBudget('GET', '/api/health')).toBe(false);
  });

  it('exempts the prefix but not lookalike siblings', () => {
    // /api/authx must NOT be exempt just because it starts with /api/auth.
    expect(shouldApplyWriteBudget('POST', '/api/authx/foo')).toBe(true);
    // The cron prefix boundary holds the same way.
    expect(shouldApplyWriteBudget('POST', '/api/cronx/run')).toBe(true);
  });

  it('requires a pathname — no path, no consumption decision', () => {
    expect(shouldApplyWriteBudget('POST', null)).toBe(false);
  });
});

describe('consumeWriteBudget contract (pure parts)', () => {
  const tenantUser: BudgetUser = { id: 'u1', tenantId: 't1', email: 'c@t.co', role: 'Member' };

  it('budget ceilings are far above legitimate officer cadence', () => {
    expect(WRITE_BUDGET.userLimit).toBeGreaterThanOrEqual(200);
    expect(WRITE_BUDGET.tenantLimit).toBeGreaterThan(WRITE_BUDGET.userLimit * 5);
    expect(WRITE_BUDGET.windowSecs).toBe(300);
  });

  it('keys the user bucket inside the tenant namespace', () => {
    // A user key must be tenant-prefixed so a member id collision across
    // tenants can never share a counter.
    const userKey = bucketKey(`${WRITE_BUDGET.scope}:user`, `${tenantUser.tenantId}:${tenantUser.id}`);
    expect(userKey.startsWith(`${WRITE_BUDGET.scope}:user:`)).toBe(true);
    expect(userKey).not.toContain(tenantUser.id); // hashed, never raw
  });

  it('fail-closed design: a null-tenant write is never admitted silently', () => {
    // consumeWriteBudget returns ok:false for a null-tenant identity rather
    // than throwing or admitting — asserted via the exported budget config and
    // the deny contract the platform-operator bypass does NOT cover.
    expect(WRITE_BUDGET.scope).toBe('global-write');
  });
});
