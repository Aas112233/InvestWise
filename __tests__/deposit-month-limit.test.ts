import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { depositMonthConflictMessage } from '@/lib/deposit-month-limit';

/**
 * Regression guard: one deposit per member per month (§12 invariant).
 *
 * Every deposit write path used to accept unlimited deposits per member-month
 * — direct deposits, single/bulk requests, approvals, edits and the finance
 * module each posted freely, double-counting the member's contribution and
 * the fund balance. The rule now lives in ONE predicate
 * (lib/deposit-month-limit.ts) enforced on every path. These tests fail if a
 * path loses its check or the helper's occupancy semantics drift. Source-level
 * guards — no database required.
 */

const root = fileURLToPath(new URL('../', import.meta.url));

/** Every path that creates or settles a deposit must enforce the rule. */
const ENFORCING_PATHS = [
  'app/api/deposits/route.ts',
  'app/api/deposits/request/route.ts',
  'app/api/deposits/request/bulk/route.ts',
  'app/api/deposits/[id]/approve/route.ts',
  'server/src/modules/finance/service.ts',
];

describe('one deposit per member per month', () => {
  it('ships the shared rule helper with the canonical occupancy semantics', () => {
    expect(existsSync(`${root}lib/deposit-month-limit.ts`)).toBe(true);
    const helper = readFileSync(`${root}lib/deposit-month-limit.ts`, 'utf8');
    // Settled money occupies the month.
    expect(helper).toContain("IN ('Completed', 'Success')");
    // A pending request occupies it — case-insensitive, so the request
    // routes' 'PENDING' and the finance Zod enum's 'Pending' both count.
    expect(helper).toContain('lower(COALESCE(');
    expect(helper).toContain("'pending'");
    // …but a reverted DIRECT deposit (category 'Deposit' + PENDING) freed
    // its month and must not block — the revert→re-approve cycle depends
    // on this, and a reverted month must be depositable again.
    expect(helper).toContain("<> 'Deposit'");
    // Soft-deleted rows never occupy, and the month expression matches the
    // one GET /api/deposits?depositMonth= filters on.
    expect(helper).toContain(
      "COALESCE(${transactions.depositMonth}, to_char(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM'))",
    );
    expect(helper).toContain('DUPLICATE_MONTH');
  });

  it('enforces the rule on every deposit write path', () => {
    for (const path of ENFORCING_PATHS) {
      const src = readFileSync(`${root}${path}`, 'utf8');
      expect(src, path).toContain('findDepositMonthOccupant');
    }
  });

  it('excludes the row itself on the approval paths so re-approval after revert keeps working', () => {
    const approve = readFileSync(`${root}app/api/deposits/[id]/approve/route.ts`, 'utf8');
    expect(approve).toContain('excludeId: id');
    const service = readFileSync(`${root}server/src/modules/finance/service.ts`, 'utf8');
    expect(service).toContain('excludeId: txn.id');
  });

  it('guards within-batch duplicates in the bulk request route', () => {
    // The batch inserts in ONE statement, so rows of the same batch are
    // invisible to each other's in-tx check — an explicit set is required.
    const src = readFileSync(`${root}app/api/deposits/request/bulk/route.ts`, 'utf8');
    expect(src).toContain('seenBatchMembers');
  });

  it('replaces the fund-scoped, settled-only duplicate check in the finance bulk path', () => {
    // The old check missed cross-fund duplicates and pending requests; the
    // canonical condition covers both.
    const src = readFileSync(`${root}server/src/modules/finance/service.ts`, 'utf8');
    const block = src.slice(src.indexOf('export async function bulkAddDeposits'));
    expect(block).toContain('depositMonthOccupiedCondition');
    expect(block).not.toContain("inArray(transactions.status, ['Completed', 'Success'])");
    expect(block).not.toContain('eq(transactions.fundId, data.fundId)');
  });

  it('formats the rejection with the month, a code and the way out', () => {
    const settled = depositMonthConflictMessage('2026-10', {
      id: 'tx-1',
      memberId: 'm-1',
      status: 'Completed',
      category: 'Deposit',
      referenceNumber: null,
    });
    expect(settled).toContain('2026-10');
    expect(settled).toContain('DUPLICATE_MONTH');
    expect(settled).toContain('Revert the recorded deposit first');

    const pending = depositMonthConflictMessage('2026-10', {
      id: 'tx-2',
      memberId: 'm-1',
      status: 'PENDING',
      category: 'Deposit Request',
      referenceNumber: null,
    });
    expect(pending).toContain('Approve or reject the pending request first');
  });
});
