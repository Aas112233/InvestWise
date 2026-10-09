import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for the silently-zero member totals (report issue 11).
 *
 * The per-member "Total Deposits" and "Last deposit" columns were 0 / null for
 * every row. The SQL itself was correct — but it was built by interpolating
 * Drizzle table objects inside a `sql` template, e.g.
 *
 *     WHERE ${transactions.memberId} = ${members.id}
 *
 * Drizzle de-qualifies those references when the referenced table is also the
 * query's FROM target: it emitted a bare `"member_id" = "id"`. Inside the
 * subquery's scope the bare `"id"` binds to `transactions`, not to the outer
 * `members` row, so the correlation silently compared a table to itself and
 * matched nothing. The fix writes the outer reference as a literal quoted
 * identifier — `"members"."id"` — which Drizzle cannot rewrite.
 *
 * A behavioural test needs a live Postgres, which this suite deliberately does
 * not have. Inspecting the generated source is the cheapest check that fails
 * loudly if someone reintroduces the interpolation.
 */
const SERVICE_PATH = join(
  process.cwd(),
  'server/src/modules/members/service.ts',
);

describe('members service — correlated subquery outer references', () => {
  const source = readFileSync(SERVICE_PATH, 'utf8');

  it('qualifies the outer member row with a literal identifier', () => {
    // Both derived columns must correlate against "members"."id".
    const literalRefs = source.match(/"members"\."id"/g) ?? [];
    expect(literalRefs.length).toBeGreaterThanOrEqual(3); // total, lastMonth, hasTransactions
  });

  it('never interpolates the outer members table inside a subquery', () => {
    // The footgun: `${members.id}` / `${members.tenantId}` used as the OUTER
    // side of a correlation. Top-level column refs (e.g. a plain select of
    // members.totalContributed) are fine, so only the correlated-looking
    // "inner.column = ${members.x}" shapes are rejected.
    const correlatedInterpolation = /t\.(?:member_id|tenant_id)\s*=\s*\$\{members\./g;
    expect(source.match(correlatedInterpolation)).toBeNull();
  });

  it('correlates on the tenant as well as the id (no cross-tenant reads)', () => {
    // Dropping the tenant predicate would let one tenant's deposits leak into
    // another's totals the moment ids ever collided.
    const tenantCorrelations = source.match(/"members"\."tenant_id"/g) ?? [];
    expect(tenantCorrelations.length).toBeGreaterThanOrEqual(2);
  });
});
