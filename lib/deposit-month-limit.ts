import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
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
 * Month the deposit is FOR — same expression the deposits list filters on, so
 * the write rule, the Month column and the per-member month grid can never
 * disagree. Defined once: three call sites used to spell it out separately.
 */
const DEPOSIT_MONTH_KEY_EXPR = sql<string>`COALESCE(${transactions.depositMonth}, to_char(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM'))`;

/**
 * Settled money, or a pending request-style row. A reverted direct deposit
 * (category 'Deposit' + PENDING) freed its month and must not block; REJECTED
 * rows are neither settled nor pending.
 */
const OCCUPYING_STATUS_CONDITION = sql`(${transactions.status} IN ('Completed', 'Success') OR (lower(COALESCE(${transactions.status}, '')) = 'pending' AND COALESCE(${transactions.category}, '') <> 'Deposit'))`;

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
    sql`${DEPOSIT_MONTH_KEY_EXPR} = ${args.depositMonthKey}`,
    OCCUPYING_STATUS_CONDITION,
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
    sql`${DEPOSIT_MONTH_KEY_EXPR} = ${args.depositMonthKey}`,
    OCCUPYING_STATUS_CONDITION,
  ) as SQL;
}

/**
 * Multi-month variant for ONE member: the same rule widened across a fiscal
 * year's worth of month keys. The month set is OR-ed as parameterized
 * equalities (at most twelve) rather than an `IN` over a computed expression,
 * so the predicate stays indexable and identical on both drizzle copies.
 */
export function depositMonthsOccupiedCondition(args: {
  tenantId: string;
  memberId: string;
  depositMonthKeys: string[];
}): SQL | null {
  if (args.depositMonthKeys.length === 0) return null;
  return and(
    eq(transactions.tenantId, args.tenantId),
    eq(transactions.memberId, args.memberId),
    eq(transactions.type, 'Deposit'),
    eq(transactions.isDeleted, false),
    OCCUPYING_STATUS_CONDITION,
    or(...args.depositMonthKeys.map((key) => sql`${DEPOSIT_MONTH_KEY_EXPR} = ${key}`)),
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

/** An occupant plus the month it occupies and the money already recorded. */
export interface DepositMonthOccupancy extends DepositMonthOccupant {
  /** The YYYY-MM month this row occupies (the stored month, else the date's). */
  depositMonthKey: string;
  amount: string | null;
}

/**
 * The per-member month grid: which of `depositMonthKeys` already hold a
 * deposit, keyed by month. Reads through the SAME predicate the write path
 * enforces, so a month the grid greys out is exactly a month the bulk POST
 * would reject — the desk never selects a month and then eats a 409.
 */
export async function findDepositMonthOccupancyInRange(
  db: unknown,
  args: { tenantId: string; memberId: string; depositMonthKeys: string[] },
): Promise<Map<string, DepositMonthOccupancy>> {
  const occupancy = new Map<string, DepositMonthOccupancy>();
  const condition = depositMonthsOccupiedCondition(args);
  if (!condition) return occupancy;

  const rows = await asQueryable(db)
    .select({
      ...OCCUPANT_FIELDS,
      amount: transactions.amount,
      depositMonthKey: DEPOSIT_MONTH_KEY_EXPR,
    })
    .from(transactions)
    .where(condition)
    .limit(args.depositMonthKeys.length);

  for (const row of rows) {
    // A settled row wins over a pending one for the same month; the write
    // rule forbids both existing, so this only orders a corrupt legacy state.
    const existing = occupancy.get(row.depositMonthKey);
    if (existing && isPendingStatus(existing.status) && !isPendingStatus(row.status)) {
      occupancy.set(row.depositMonthKey, row);
      continue;
    }
    if (!existing) occupancy.set(row.depositMonthKey, row);
  }
  return occupancy;
}

function isPendingStatus(status: string | null): boolean {
  return String(status ?? '').toLowerCase() === 'pending';
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
