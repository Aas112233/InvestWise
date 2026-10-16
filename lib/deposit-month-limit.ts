import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { transactions } from '@/db/schema/index';
import type { getDb } from '@/db/index';

/**
 * Business rule: a member may deposit for a given calendar month at most once
 * (the month the deposit is FOR — `deposit_month`, falling back to the
 * collected-date month for legacy rows, exactly the predicate GET
 * /api/deposits?depositMonth= filters on).
 *
 * Before this helper, every deposit write path accepted unlimited deposits per
 * member-month: a second direct deposit, a second request, a bulk row, an
 * approval, or an edit that moved a deposit into an occupied month all posted
 * freely — double-counting the member's contribution and the fund balance.
 * The rule now lives in ONE predicate enforced on every write path:
 *
 *   - POST   /api/deposits                    (direct deposit)
 *   - POST   /api/deposits/request            (single request)
 *   - POST   /api/deposits/request/bulk       (bulk request)
 *   - POST   /api/deposits/[id]/approve       (request → Completed)
 *   - finance.addDeposit / editDeposit / approveDeposit / bulkAddDeposits
 *
 * A month is OCCUPIED by an existing, non-deleted Deposit row for the same
 * member when it is either:
 *   - settled money — status IN ('Completed', 'Success') (any category: a
 *     direct deposit, an approved request, a finance-path row), or
 *   - a pending REQUEST — status pending (case-insensitive; the request routes
 *     write 'PENDING', the finance Zod enum allows 'Pending') with a category
 *     that is not 'Deposit'.
 *
 * A REVERTED direct deposit (category 'Deposit' + PENDING) deliberately does
 * NOT occupy its month: the revert returned the money to the fund and debited
 * the member, so the month is free again — the officer re-approves that row or
 * records a fresh deposit for it. A REJECTED request also frees the month.
 *
 * The `excludeId` argument lets the approve/edit paths ignore the row being
 * transitioned, so a reverted deposit can be re-approved and an edit that
 * keeps a deposit in its own month never conflicts with itself.
 */

/** The blocking row, as surfaced to the caller for the error message. */
export interface DepositMonthOccupant {
  id: string;
  memberId: string | null;
  status: string | null;
  category: string | null;
  referenceNumber: string | null;
}

type DbLike = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Dual-drizzle bridge — same rationale as lib/fiscal-guard.ts's `fiscalGuardTx`:
 * callers run on both the root (0.45) and server/ (0.38) drizzle instances.
 * The transaction objects are runtime-compatible (same postgres-js driver,
 * same table metadata); only the TS generics differ. Narrowing through
 * `unknown` keeps ONE source of truth for the rule instead of a server-local
 * copy that could drift.
 */
function asQueryable(db: unknown): DbLike {
  return db as DbLike;
}

const OCCUPANT_FIELDS = {
  id: transactions.id,
  memberId: transactions.memberId,
  status: transactions.status,
  category: transactions.category,
  referenceNumber: transactions.referenceNumber,
} as const;

/**
 * The shared month-occupancy predicate. Kept as a condition builder (not a
 * query runner) so batch callers can widen it with `inArray` on member ids
 * and every call site composes it inside its own transaction.
 */
export function depositMonthOccupiedCondition(args: {
  tenantId: string;
  memberId: string;
  depositMonthKey: string;
  excludeId?: string | null;
}): SQL {
  const conditions: SQL[] = [
    eq(transactions.tenantId, args.tenantId),
    eq(transactions.memberId, args.memberId),
    eq(transactions.type, 'Deposit'),
    eq(transactions.isDeleted, false),
    // Month the deposit is FOR — same expression the deposits list filters on,
    // so the write rule and the Month column can never disagree.
    sql`COALESCE(${transactions.depositMonth}, to_char(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM')) = ${args.depositMonthKey}`,
    // Settled money, or a pending request-style row. A reverted direct
    // deposit (category 'Deposit' + PENDING) freed its month and must not
    // block; REJECTED rows are neither settled nor pending.
    sql`(${transactions.status} IN ('Completed', 'Success') OR (lower(COALESCE(${transactions.status}, '')) = 'pending' AND COALESCE(${transactions.category}, '') <> 'Deposit'))`,
  ];
  if (args.excludeId) {
    conditions.push(sql`${transactions.id} <> ${args.excludeId}`);
  }
  return and(...conditions) as SQL;
}

/** Batch variant of {@link depositMonthOccupiedCondition} (no exclude). */
export function depositMonthOccupiedBatchCondition(args: {
  tenantId: string;
  memberIds: string[];
  depositMonthKey: string;
}): SQL {
  return and(
    eq(transactions.tenantId, args.tenantId),
    inArray(transactions.memberId, args.memberIds),
    eq(transactions.type, 'Deposit'),
    eq(transactions.isDeleted, false),
    sql`COALESCE(${transactions.depositMonth}, to_char(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM')) = ${args.depositMonthKey}`,
    sql`(${transactions.status} IN ('Completed', 'Success') OR (lower(COALESCE(${transactions.status}, '')) = 'pending' AND COALESCE(${transactions.category}, '') <> 'Deposit'))`,
  ) as SQL;
}

/** Find the row that already occupies this member's month, if any. */
export async function findDepositMonthOccupant(
  db: unknown,
  args: { tenantId: string; memberId: string; depositMonthKey: string; excludeId?: string | null },
): Promise<DepositMonthOccupant | null> {
  const [row] = await asQueryable(db)
    .select(OCCUPANT_FIELDS)
    .from(transactions)
    .where(depositMonthOccupiedCondition(args))
    .limit(1);
  return row ?? null;
}

/** Batch finder: every occupant for the given members in one month. */
export async function findDepositMonthOccupants(
  db: unknown,
  args: { tenantId: string; memberIds: string[]; depositMonthKey: string },
): Promise<DepositMonthOccupant[]> {
  if (args.memberIds.length === 0) return [];
  return asQueryable(db)
    .select(OCCUPANT_FIELDS)
    .from(transactions)
    .where(depositMonthOccupiedBatchCondition(args))
    .limit(args.memberIds.length);
}

/**
 * §11-formatted rejection message. Tells the user exactly which month is
 * taken and the sanctioned way to free it (reject/approve the pending
 * request, or revert the settled deposit) — never a masked generic error.
 */
export function depositMonthConflictMessage(
  depositMonthKey: string,
  occupant?: DepositMonthOccupant | null,
): string {
  const isPendingRequest = !!occupant && String(occupant.status ?? '').toLowerCase() === 'pending';
  const next = isPendingRequest
    ? 'Approve or reject the pending request first'
    : 'Revert the recorded deposit first';
  return `[Field 'depositMonth', Code: DUPLICATE_MONTH] This member already has a deposit for ${depositMonthKey}. Only one deposit per member per month is allowed — ${next} if this entry should replace it.`;
}
