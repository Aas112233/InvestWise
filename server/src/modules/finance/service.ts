import { eq, and, or, desc, asc, count, ilike, inArray, gte, lte, sql, aliasedTable } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getDb, getSql } from '../../lib/db';
import {
  transactions,
  funds,
  members,
  projects,
  projectUpdates,
  auditLogs,
  deletedRecords,
  users,
  systemSettings,
} from '../../db/schema/index';
import type { SQL } from 'drizzle-orm';
import { memberDisplayNameSql, assertMemberNotSuspended } from '../../../../lib/member-display';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../shared/errors';
import { getPaginationParams, formatPaginatedResponse, requireTenant, type SessionUser } from '../../middleware/api';
import {
  parsePositiveAmount,
  fromCents,
  toCents,
  parseDepositMonthToIso,
} from '@/lib/money';
import { assertIntegralShares } from '@/lib/shares';
import { isAllowedDepositMethod, normalizePaymentMethods } from '@/lib/payment-methods';
import { decideReversal } from '@/lib/transaction-reversal';
import { DEPOSIT_FUND_REQUIRED_MESSAGE, isDepositFund } from '@/lib/deposit-fund';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { calendarDayForInstant, dayRangeUtc, parseBusinessDate } from '@/lib/tenant-time';
import { fiscalMonthKeys, isFiscalMonthName } from '@/lib/fiscal-periods';
import {
  depositMonthOccupiedCondition,
  findDepositMonthOccupant,
  findDepositMonthOccupancyInRange,
  depositMonthConflictMessage,
} from '@/lib/deposit-month-limit';
import {
  computeDepositEditDelta,
  findEquityViolation,
  findFundDeficitViolation,
  fundBalanceAcrossEdit,
  isUnchangedDepositDate,
  type FundBalanceSnapshot,
  type MemberEquitySnapshot,
} from '@/lib/deposit-edit-delta';

/**
 * Dual-drizzle bridge. This service runs on the server/ drizzle instance
 * (0.38) while the shared fiscal guard is typed against the root instance
 * (0.45). The transaction objects are runtime-compatible — same postgres-js
 * driver, same table metadata — so only the TS generics differ. Narrowing
 * through `unknown` here keeps ONE source of truth for the closed-period rule
 * instead of duplicating it in a server-local copy that could drift.
 */
const fiscalGuardTx = (tx: unknown): Parameters<typeof assertFiscalPeriodOpen>[0] =>
  tx as Parameters<typeof assertFiscalPeriodOpen>[0];

/**
 * Core financial engine — 1:1 behavioral port of the Express finance service
 * with the §12 money discipline made explicit:
 *  - amounts validated as positive integer cents (amount > 0),
 *  - balance mutations in SQL numeric(15,2) arithmetic (never float),
 *  - soft delete only (isDeleted + deletedBy + deletionReason + archive),
 *  - idempotent batch reference numbers for bulk deposits/dividend runs.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format integer cents as a decimal(15,2) string for the DB boundary. */
const fmt = (cents: number) => fromCents(cents);

/** Number cast helper for SQL-summed values (display only). */
function toNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

/** Escape special regex characters. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive flexible member-id regex ("MEM BER" matches "M-EM-BER"). */
function buildFlexibleMemberIdRegex(search: string): string | null {
  const compact = search.replace(/[\s\-_]+/g, '').trim();
  if (!compact) return null;
  return compact.split('').map((ch) => escapeRegex(ch)).join('[-_\\s]*');
}

/** The tenant's books run on this clock (system_settings.timezone). */
async function tenantTimezone(tenantId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ timezone: systemSettings.timezone })
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);
  return row?.timezone || 'Asia/Dhaka';
}

/** Resolve the effective deposit date (money received) from date/month label. */
function resolveDepositDate(
  date?: string | null,
  depositMonth?: string | null,
  opts: { allowFuture?: boolean } = {},
): Date {
  if (date) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('date must be a valid ISO date (yyyy-mm-dd)', 400, 'INVALID_DATE');
    }
    // Back-entry is normal bookkeeping; time travel is not. A future posting
    // date would desync the row from balances computed against today (central
    // rule: lib/tenant-time parseBusinessDate).
    //
    // `allowFuture` is for the EDIT path only, and only when the date the
    // client sends is exactly the date the row ALREADY carries: such an edit
    // introduces no new future posting, it merely preserves the one the row
    // was created with (a deposit booked ahead for a future month). Without
    // this, a row created for a future month could never be edited again —
    // the very correction it was created for would be impossible to make.
    if (!opts.allowFuture) {
      const { error, code } = parseBusinessDate(date);
      if (error) throw new AppError(error, 400, code);
    }
    return parsed;
  }
  const iso = parseDepositMonthToIso(depositMonth);
  if (iso) return new Date(`${iso}T00:00:00.000Z`);
  return new Date();
}

/**
 * Month the deposit is FOR (YYYY-MM). The explicitly selected month wins;
 * the collected-date month is only the fallback when none was sent. An
 * explicit but unparseable value is rejected, never silently replaced.
 */
function resolveDepositMonthKey(depositMonth: string | null | undefined, fallback: Date, tz = 'Asia/Dhaka'): string {
  // The month a deposit is FOR belongs to the tenant's calendar, not UTC's.
  if (!depositMonth) return calendarDayForInstant(fallback, tz).slice(0, 7);
  const iso = parseDepositMonthToIso(depositMonth);
  if (!iso) {
    throw new AppError("[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format", 400, 'VALIDATION_ERROR');
  }
  return iso.slice(0, 7);
}

/**
 * Resolve the submission date (when recorded). Collected date and submission
 * date may differ (collected 5th, entered 7th). Defaults to now, settable for
 * back-entry. Never trusts client junk — falls back to now.
 */
function resolveSubmittedDate(submittedDate?: string | null): Date {
  if (submittedDate) {
    const parsed = new Date(submittedDate);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('submittedDate must be a valid ISO date (yyyy-mm-dd)', 400, 'INVALID_DATE');
    }
    const { error, code } = parseBusinessDate(submittedDate);
    if (error) throw new AppError(error, 400, code);
    return parsed;
  }
  return new Date();
}

/**
 * Resolve the effective transfer date. A client-supplied date is the day the
 * transfer is FOR (back-entry); junk falls back to the operation time, same
 * convention as resolveSubmittedDate. createdAt/updatedAt stay the wall-clock
 * moment the transfer was actually performed.
 */
function resolveTransferDate(date?: string | null, operationTime?: Date): Date {
  if (date) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('date must be a valid ISO date (yyyy-mm-dd)', 400, 'INVALID_DATE');
    }
    const { error, code } = parseBusinessDate(date);
    if (error) throw new AppError(error, 400, code);
    return parsed;
  }
  return operationTime ?? new Date();
}

interface DepositInput {
  memberId: string;
  amount: number | string;
  fundId: string;
  description?: string | null;
  date?: string | null;
  /** Alias for date — UI sends collectedDate explicitly. */
  collectedDate?: string | null;
  /** When recorded in the app. Defaults to now, allows past for back-entry. */
  submittedDate?: string | null;
  status?: 'Completed' | 'Processing' | 'Pending' | null;
  cashierName?: string | null;
  depositMethod?: string | null;
  depositMonth?: string | null;
}

interface ExpenseInput {
  amount: number | string;
  fundId: string;
  description?: string | null;
  category?: string | null;
  date?: string | null;
  memberId?: string | null;
  projectId?: string | null;
}

interface EarningInput {
  amount: number | string;
  fundId: string;
  projectId?: string | null;
  description?: string | null;
  category?: string | null;
  date?: string | null;
}

interface TransferInput {
  sourceFundId: string;
  targetFundId: string;
  amount: number | string;
  description?: string;
  referenceNumber?: string;
  /** Effective transfer date (yyyy-mm-dd or full ISO). Omitted = operation time. */
  date?: string | null;
}

interface EquityTransferInput {
  fromMemberId: string;
  transfers: Array<{ toMemberId: string; amount?: number; shares?: number }>;
  reason: string;
  /** Retry key. Absent means a fresh run; a repeat of a known key is rejected. */
  referenceNumber?: string;
  /**
   * Required when a row moves shares with no contribution behind it. Such a
   * row transfers a claim on future surplus to someone who never funded it, so
   * it must be an acknowledged gift rather than an unchecked blank field.
   */
  giftAcknowledged?: boolean;
  /**
   * Required when a row moves contribution with no shares behind it — the
   * recipient's equity rises without gaining any ownership of the pool, so it
   * is a capital reallocation, not a share transfer, and must be deliberate.
   */
  amountOnlyAcknowledged?: boolean;
}

interface BulkDepositInput {
  fundId: string;
  requestKey?: string;
  commonMonth?: string;
  cashierName?: string;
  depositMethod?: string;
  deposits: Array<{
    memberId: string;
    amount: number | string;
    depositMonth?: string;
    date?: string;
  }>;
}

export type { DepositInput, ExpenseInput, EarningInput, TransferInput, EquityTransferInput, BulkDepositInput };

// ---------------------------------------------------------------------------
// 1. getTransactions — Paginated ledger with totals
// ---------------------------------------------------------------------------

export async function getTransactions(query: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const { page, limit, skip, sortBy: sortByParam } = getPaginationParams(query, {
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const search = String(query.search || '').trim();
  const searchField = query.searchField || 'all';
  const sortBy = query.sortBy || sortByParam;
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const conditions: (SQL | undefined)[] = [];

  // Soft-delete filter — deleted rows never appear in the ledger.
  conditions.push(eq(transactions.isDeleted, false));
  // Tenant isolation — every ledger row belongs to one tenant.
  conditions.push(eq(transactions.tenantId, tenantId));

  // --- search -------------------------------------------------------------
  if (search) {
    if (searchField === 'amount') {
      const num = Number(search);
      if (!Number.isNaN(num)) conditions.push(eq(transactions.amount, String(num)));
    } else if (searchField === 'id') {
      if (isValidUUID(search)) {
        conditions.push(eq(transactions.id, search));
      } else {
        conditions.push(ilike(transactions.referenceNumber, `%${search}%`));
      }
    } else if (searchField === 'memberId') {
      const flexible = buildFlexibleMemberIdRegex(search);
      const memberConds: (SQL | undefined)[] = [ilike(members.memberId, `%${search}%`)];
      if (flexible) memberConds.push(sql`${members.memberId} ~* ${flexible}`);
      const matchingMembers = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), or(...memberConds)));

      if (matchingMembers.length > 0) {
        conditions.push(inArray(transactions.memberId, matchingMembers.map((m) => m.id)));
      } else {
        conditions.push(sql`1=0`);
      }
    } else if (searchField === 'memberName') {
      const matchingMembers = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), ilike(members.name, `%${search}%`)));
      if (matchingMembers.length > 0) {
        conditions.push(inArray(transactions.memberId, matchingMembers.map((m) => m.id)));
      } else {
        conditions.push(sql`1=0`);
      }
    } else if (searchField === 'fundName') {
      const matchingFunds = await db
        .select({ id: funds.id })
        .from(funds)
        .where(and(eq(funds.tenantId, tenantId), ilike(funds.name, `%${search}%`)));
      if (matchingFunds.length > 0) {
        conditions.push(inArray(transactions.fundId, matchingFunds.map((f) => f.id)));
      } else {
        conditions.push(sql`1=0`);
      }
    } else {
      // 'all' — multi-field search
      const flexible = buildFlexibleMemberIdRegex(search);
      const [memberMatches, fundMatches] = await Promise.all([
        db
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              eq(members.tenantId, tenantId),
              or(
                ilike(members.name, `%${search}%`),
                ilike(members.memberId, `%${search}%`),
                ...(flexible ? [sql`${members.memberId} ~* ${flexible}`] : []),
              ),
            ),
          ),
        db.select({ id: funds.id }).from(funds).where(and(eq(funds.tenantId, tenantId), ilike(funds.name, `%${search}%`))),
      ]);

      const orConds: (SQL | undefined)[] = [
        ilike(transactions.type, `%${search}%`),
        ilike(transactions.description, `%${search}%`),
        ilike(transactions.status, `%${search}%`),
        ilike(transactions.referenceNumber, `%${search}%`),
      ];
      if (memberMatches.length > 0) {
        orConds.push(inArray(transactions.memberId, memberMatches.map((m) => m.id)));
      }
      if (fundMatches.length > 0) {
        orConds.push(inArray(transactions.fundId, fundMatches.map((f) => f.id)));
      }
      const searchNum = Number(search);
      if (!Number.isNaN(searchNum)) orConds.push(eq(transactions.amount, String(searchNum)));
      if (isValidUUID(search)) orConds.push(eq(transactions.id, search));

      conditions.push(or(...orConds));
    }
  }

  if (query.type) conditions.push(eq(transactions.type, query.type));
  if (query.status) conditions.push(eq(transactions.status, query.status));
  if (query.projectId) conditions.push(eq(transactions.projectId, query.projectId));
  if (query.memberId) conditions.push(eq(transactions.memberId, query.memberId));
  if (query.fundId) conditions.push(eq(transactions.fundId, query.fundId));

  // Date bounds are TENANT-LOCAL days (Settings → Timezone). The old form
  // used `setHours(23:59)` — the API server's clock — so the window shifted
  // with server deployment.
  const filterTz = await tenantTimezone(tenantId);
  if (query.startDate) {
    const start = dayRangeUtc(query.startDate, filterTz).start;
    conditions.push(sql`${transactions.date} >= ${start.toISOString()}::timestamptz`);
  }
  if (query.endDate) {
    const end = dayRangeUtc(query.endDate, filterTz).end;
    conditions.push(sql`${transactions.date} <= ${end.toISOString()}::timestamptz`);
  }
  if (query.month && query.year) {
    const month = Number.parseInt(query.month, 10);
    const year = Number.parseInt(query.year, 10);
    if (!Number.isNaN(month) && !Number.isNaN(year)) {
      const start = new Date(year, month - 1, 1);
      conditions.push(sql`${transactions.date} >= ${start.toISOString()}::timestamptz`);
      conditions.push(sql`${transactions.date} < ${new Date(year, month, 1).toISOString()}::timestamptz`);
    }
  }

  const sortFieldMap: Record<string, unknown> = {
    date: transactions.date,
    amount: transactions.amount,
    type: transactions.type,
    status: transactions.status,
    description: transactions.description,
    referenceNumber: transactions.referenceNumber,
    category: transactions.category,
    handlingOfficer: transactions.handlingOfficer,
    depositMethod: transactions.depositMethod,
    createdAt: transactions.createdAt,
    updatedAt: transactions.updatedAt,
  };
  const sortColumn = (sortFieldMap[sortBy] as typeof transactions.date) || transactions.date;
  const orderBy =
    sortOrder === 'asc'
      ? [asc(sortColumn), asc(transactions.createdAt)]
      : [desc(sortColumn), desc(transactions.createdAt)];

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const authorizer = aliasedTable(users, 'txn_authorizer');
  const creator = aliasedTable(users, 'txn_creator');

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const totalsConditions: (SQL | undefined)[] = [];
  for (const c of conditions) totalsConditions.push(c);
  totalsConditions.push(inArray(transactions.status, ['Completed', 'Processing']));

  const [[totalResult], rows, [totalsRow]] = await Promise.all([
    db.select({ count: count() }).from(transactions).where(whereClause),
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        description: transactions.description,
        category: transactions.category,
        referenceNumber: transactions.referenceNumber,
        date: transactions.date,
        status: transactions.status,
        memberId: transactions.memberId,
        projectId: transactions.projectId,
        fundId: transactions.fundId,
        handlingOfficer: transactions.handlingOfficer,
        depositMethod: transactions.depositMethod,
        balanceBefore: transactions.balanceBefore,
        balanceAfter: transactions.balanceAfter,
        isDeleted: transactions.isDeleted,
        memberDisplayId: members.memberId,
        // Display form (suspended members are marked in their own name).
        // The fragment binds the root schema copy, but drizzle emits the same
        // "members"."status" / "members"."name" columns this query uses.
        memberName: memberDisplayNameSql,
        memberEmail: members.email,
        fundName: funds.name,
        projectName: projects.title,
        authorizedByName: authorizer.name,
        createdByName: creator.name,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
      })
      .from(transactions)
      .leftJoin(members, eq(transactions.memberId, members.id))
      .leftJoin(funds, eq(transactions.fundId, funds.id))
      .leftJoin(projects, eq(transactions.projectId, projects.id))
      .leftJoin(authorizer, eq(transactions.authorizedBy, authorizer.id))
      .leftJoin(creator, eq(transactions.createdBy, creator.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .offset(skip)
      .limit(limit),
    db
      .select({
        totalInflow: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0)`,
        totalOutflow: sql`COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend') THEN amount::numeric ELSE 0 END), 0)`,
        totalMonthly: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') AND ${transactions.date} >= ${startOfMonth.toISOString()}::timestamptz THEN amount::numeric ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(and(...totalsConditions)),
  ]);

  const totalCount = Number(totalResult?.count ?? 0);

  const data = rows.map((r) => ({
    ...r,
    amount: toNum(r.amount),
    balanceBefore: r.balanceBefore ? toNum(r.balanceBefore) : null,
    balanceAfter: r.balanceAfter ? toNum(r.balanceAfter) : null,
    memberDisplayId: r.memberDisplayId || 'N/A',
    memberName: r.memberName || 'Unknown',
    fundName: r.fundName || 'N/A',
    projectName: r.projectName || '',
    authorizedBy: r.authorizedByName || r.handlingOfficer || 'System',
    createdBy: r.createdByName || r.handlingOfficer || 'System',
    approvedBy: r.authorizedByName || r.handlingOfficer || 'System',
  }));

  const response = formatPaginatedResponse(data, page, limit, totalCount);

  return {
    ...response,
    totalInflow: toNum(totalsRow?.totalInflow),
    totalOutflow: toNum(totalsRow?.totalOutflow),
    totalMonthly: toNum(totalsRow?.totalMonthly),
  };
}

// ---------------------------------------------------------------------------
// 2. addDeposit
// ---------------------------------------------------------------------------

export async function addDeposit(
  data: DepositInput,
  user: SessionUser,
) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    let targetMemberId = data.memberId;
    const isPrivileged = user.role === 'Admin' || user.role === 'Administrator' || user.role === 'Manager';

    // Non-privileged users always deposit for themselves (request flow).
    if (!isPrivileged) {
      const conds: (SQL | undefined)[] = [eq(members.userId, user.id)];
      if (user.memberId) {
        if (isValidUUID(user.memberId)) conds.push(eq(members.id, user.memberId));
        conds.push(eq(members.memberId, user.memberId));
      }
      if (user.email) conds.push(ilike(members.email, user.email));

      const validConditions = conds.filter(Boolean) as SQL[];
      if (validConditions.length > 0) {
        const matching = await tx
          .select()
          .from(members)
          .where(and(eq(members.tenantId, tenantId), or(...validConditions)))
          .limit(1);
        if (matching.length > 0) {
          const first = matching[0];
          if (first) targetMemberId = first.id;
        }
      }
    }

    const [fund] = await tx.select().from(funds).where(and(eq(funds.id, data.fundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!fund) throw new NotFoundError('Fund');
    if (!isDepositFund(fund)) throw new AppError(DEPOSIT_FUND_REQUIRED_MESSAGE, 400, 'INVALID_FUND_TYPE');
    const [member] = await tx.select().from(members).where(and(eq(members.id, targetMemberId), eq(members.tenantId, tenantId))).for('update').limit(1);
    if (!member) throw new NotFoundError('Member');
    assertMemberNotSuspended(member, 'recording a deposit');

    // amount > 0 enforced in cents (§12)
    const amountCents = parsePositiveAmount(data.amount);

    const status = data.status || 'Completed';
    const isCompleted = status === 'Completed';
    const balanceBeforeCents = toCents(fund.balance ?? '0');

    // Collected date is the ledger date; the selected deposit month is the
    // month the deposit is FOR (may differ for back-entry).
    const collectedDate = resolveDepositDate(data.collectedDate ?? data.date, data.depositMonth);
    const depositMonthKey = resolveDepositMonthKey(data.depositMonth, collectedDate, await tenantTimezone(tenantId));
    const submittedDate = resolveSubmittedDate(data.submittedDate);

    // §12: a posted deposit must land in an OPEN fiscal period (the native
    // /api/deposits route enforces this — the service path must not be a
    // closed-period back door).
    await assertFiscalPeriodOpen(fiscalGuardTx(tx), tenantId, collectedDate);

    // §12 one-deposit-per-member-per-month (canonical rule, any fund, also
    // counts pending requests). The member row is locked FOR UPDATE above, so
    // concurrent deposits for this member serialize on this check. A reverted
    // direct deposit (category 'Deposit' + PENDING) freed its month and does
    // not block.
    const monthOccupant = await findDepositMonthOccupant(tx, {
      tenantId,
      memberId: targetMemberId,
      depositMonthKey,
    });
    if (monthOccupant) {
      throw new AppError(depositMonthConflictMessage(depositMonthKey, monthOccupant), 409, 'DUPLICATE_DEPOSIT');
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Deposit',
        amount: fmt(amountCents),
        description: data.description || '',
        memberId: targetMemberId,
        fundId: data.fundId,
        date: collectedDate,
        submittedDate,
        status,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name || data.cashierName || 'System',
        depositMethod: data.depositMethod || 'Cash',
        depositMonth: depositMonthKey,
        balanceBefore: fmt(balanceBeforeCents),
        balanceAfter: isCompleted ? fmt(balanceBeforeCents + amountCents) : fmt(balanceBeforeCents),
      })
      .returning();
    if (!txn) throw new AppError('Failed to record deposit', 500);

    if (isCompleted) {
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(funds.id, data.fundId));

      // Back-entry of an older month must never regress lastDepositMonth.
      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${amountCents / 100})::numeric(15,2)`,
          lastDepositMonth: sql`GREATEST(COALESCE(${members.lastDepositMonth}, ''), ${depositMonthKey})`,
          updatedAt: new Date(),
        })
        .where(eq(members.id, targetMemberId));
    }

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'ADD_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount: amountCents / 100, fundId: data.fundId, memberId: targetMemberId, status },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: amountCents / 100,
      balanceBefore: balanceBeforeCents / 100,
      balanceAfter: (isCompleted ? balanceBeforeCents + amountCents : balanceBeforeCents) / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. editDeposit
// ---------------------------------------------------------------------------

export async function editDeposit(id: string, data: DepositInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId))).for('update').limit(1);
    if (!existing) throw new NotFoundError('Transaction');
    if (existing.type !== 'Deposit') throw new AppError('Transaction is not a deposit', 400, 'INVALID_TYPE');

    // §12 closed-period immutability: the revert leg below mutates the fund and
    // member balances, so a settled deposit sitting in a CLOSED fiscal year
    // must not be edited at all (mirrors DELETE /api/transactions/[id]).
    if (existing.date) await assertFiscalPeriodOpen(fiscalGuardTx(tx), tenantId, existing.date);

    const isPrivileged =
      user.role === 'Admin' ||
      user.role === 'Administrator' ||
      user.role === 'Manager' ||
      user.permissions?.['DEPOSITS'] === 'WRITE';
    if (!isPrivileged) {
      const [userMember] = await tx
        .select({ id: members.id, memberId: members.memberId })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), or(eq(members.userId, user.id), eq(members.id, user.memberId || ''))))
        .limit(1);

      const userMemberId = userMember?.id || user.memberId;
      const isOwner = (userMemberId && existing.memberId === userMemberId) || existing.createdBy === user.id;
      if (!isOwner) throw new ForbiddenError('You can only edit your own deposit request');
      if (data.memberId && userMemberId && data.memberId !== userMemberId && data.memberId !== existing.memberId) {
        throw new ForbiddenError('A deposit request cannot be reassigned to another member. Reject it and submit a new request for the correct member.');
      }
    }

    const oldAmountCents = toCents(existing.amount);
    const oldFundId = existing.fundId!;
    const oldMemberId = existing.memberId!;
    const wasCompleted = existing.status === 'Completed' || existing.status === 'Success';

    const newAmountCents = parsePositiveAmount(data.amount);
    const newFundId = data.fundId;
    const newMemberId = data.memberId;
    // Reassigning a deposit TO a suspended member credits their equity —
    // block the move until reinstatement (keeping it on its current member
    // is fine; their money already belongs to them).
    if (newMemberId && newMemberId !== oldMemberId) {
      const [reassignedMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, newMemberId), eq(members.tenantId, tenantId)))
        .limit(1);
      if (!reassignedMember) throw new NotFoundError('Member');
      assertMemberNotSuspended(reassignedMember, 'reassigning a deposit to');
    }
    const newStatus = data.status || existing.status || 'Completed';
    const isNowCompleted = newStatus === 'Success' || newStatus === 'Completed';

    // 1. Net financial impact.
    //
    // A settled deposit contributes `amount` to its fund's balance and to
    // its member's totalContributed exactly once. An edit therefore moves
    // those balances by the DELTA between the old contribution and the new
    // one.
    //
    // It must NOT debit the old contribution and credit the new one as two
    // separate UPDATEs: the intermediate balance dips below the fund's cash
    // (and below the DB's `funds_balance_check CHECK (balance >= 0)`)
    // whenever the fund holds less than the old amount — e.g. after a
    // dividend run paid the fund out. Postgres then rejects the whole
    // transaction and the caller sees an opaque 500 instead of a result.
    // The delta is applied as ONE update per fund and per member, and a
    // delta that would overdraw a fund is refused with a clean 400 (the
    // same rule revertDeposit already enforces).
    //
    // The rule lives in lib/deposit-edit-delta.ts so it is unit-testable.
    const { fundDelta, memberDelta } = computeDepositEditDelta(
      {
        wasCompleted,
        oldFundId,
        oldMemberId,
        oldAmountCents,
      },
      {
        isNowCompleted,
        newFundId,
        newMemberId,
        newAmountCents,
      },
    );

    // Lock every fund and member this edit touches, funds first and in a
    // stable id order, so two concurrent edits that cross funds cannot
    // deadlock each other.
    const lockedFunds = new Map<string, typeof funds.$inferSelect>();
    for (const fundId of [...fundDelta.keys()].sort()) {
      const [row] = await tx.select().from(funds).where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
      if (row) lockedFunds.set(fundId, row);
    }
    const lockedMembers = new Map<string, typeof members.$inferSelect>();
    for (const memberId of [...memberDelta.keys()].sort()) {
      const [row] = await tx.select().from(members).where(and(eq(members.id, memberId), eq(members.tenantId, tenantId))).for('update').limit(1);
      if (row) lockedMembers.set(memberId, row);
    }

    // Guard: a debit may not push a fund below its floor (its minimum
    // balance, and never below zero — the DB enforces the same).
    const fundSnapshots = new Map<string, FundBalanceSnapshot>();
    for (const [fundId, fund] of lockedFunds) {
      fundSnapshots.set(fundId, {
        id: fundId,
        name: fund.name,
        balanceCents: toCents(fund.balance ?? '0'),
        minimumBalanceCents: toCents(fund.minimumBalance ?? '0'),
      });
    }
    const fundViolation = findFundDeficitViolation(fundDelta, fundSnapshots);
    if (fundViolation) {
      throw new AppError(
        `Cannot change this deposit: this change would drop ${fundViolation.fundName} below its minimum balance`,
        400,
        'FUND_DEFICIT_PREVENTED',
      );
    }

    // Guard: un-committing a deposit must never drive a member's equity
    // negative — money already invested in a project is not uncommitted and
    // cannot be reclaimed by editing a deposit.
    const memberSnapshots = new Map<string, MemberEquitySnapshot>();
    for (const [memberId, member] of lockedMembers) {
      memberSnapshots.set(memberId, {
        id: memberId,
        name: member.name,
        equityCents: toCents(member.totalContributed ?? '0'),
      });
    }
    const equityViolation = findEquityViolation(memberDelta, memberSnapshots);
    if (equityViolation) {
      throw new AppError(
        `Cannot change this deposit: ${equityViolation.memberName} has only ${(equityViolation.afterCents / 100).toFixed(2)} of uncommitted deposit balance — the rest is invested in a project. Wind that investment back first.`,
        400,
        'INSUFFICIENT_EQUITY',
      );
    }

    // Collected date stays the ledger date; the selected month (or the
    // existing stored month) is what the deposit is FOR.
    //
    // A deposit may be booked ahead for a future month (bulk deposits are
    // created before the money is collected), so its stored date can already
    // be in the future. An edit that sends back that SAME date is preserving
    // it, not introducing a new future posting — so the future-date rule is
    // relaxed exactly when the incoming date equals the row's own date. Any
    // OTHER date still goes through the rule.
    const incomingCollectedDate = data.collectedDate ?? data.date;
    const keepsExistingDate = isUnchangedDepositDate(incomingCollectedDate, existing.date);
    const depositDate = resolveDepositDate(
      incomingCollectedDate,
      data.depositMonth || existing.depositMonth || existing.description,
      { allowFuture: keepsExistingDate },
    );
    const depositMonthKey = resolveDepositMonthKey(data.depositMonth || existing.depositMonth, depositDate, await tenantTimezone(tenantId));

    // The new collected date must also land in an OPEN period — otherwise a
    // back-entry edit could move a deposit into a closed year.
    await assertFiscalPeriodOpen(fiscalGuardTx(tx), tenantId, depositDate);

    // §12 one-deposit-per-member-per-month: an edit that moves the deposit
    // (or reassigns it to another member) into a month that member already
    // occupies must be refused — the edited row itself is excluded, so
    // keeping a deposit in its own month never self-conflicts. Only checked
    // when the RESULTING row occupies the month (settled, or a pending
    // request-style row); a row staying a reverted-style pending deposit
    // (category 'Deposit') frees its month and moves freely.
    const editedOccupiesMonth =
      isNowCompleted ||
      (String(newStatus).toLowerCase() === 'pending' && (existing.category ?? '') !== 'Deposit');
    if (editedOccupiesMonth) {
      const monthOccupant = await findDepositMonthOccupant(tx, {
        tenantId,
        memberId: newMemberId,
        depositMonthKey,
        excludeId: existing.id,
      });
      if (monthOccupant) {
        throw new AppError(depositMonthConflictMessage(depositMonthKey, monthOccupant), 409, 'DUPLICATE_DEPOSIT');
      }
    }

    // 2. Apply the net financial impact computed above.
    if (isNowCompleted) {
      const newFund = lockedFunds.get(newFundId);
      if (!newFund) throw new NotFoundError('Target fund');
      // Only a fund CHANGE is policed: a legacy deposit already sitting in a
      // non-DEPOSIT fund must stay editable (amount, date, member), otherwise
      // the tenant could never correct its other fields.
      if (newFundId !== oldFundId && !isDepositFund(newFund)) {
        throw new AppError(DEPOSIT_FUND_REQUIRED_MESSAGE, 400, 'INVALID_FUND_TYPE');
      }
      const newMember = lockedMembers.get(newMemberId);
      if (!newMember) throw new NotFoundError('Member');
    }

    for (const [fundId, deltaCents] of fundDelta) {
      if (deltaCents === 0) continue;
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${deltaCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(funds.id, fundId));
    }

    for (const [memberId, deltaCents] of memberDelta) {
      if (deltaCents === 0) continue;
      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${deltaCents / 100})::numeric(15,2)`,
          // Only the member the money lands on counts as active; the member
          // it leaves keeps its own lastActive.
          ...(memberId === newMemberId ? { lastActive: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(members.id, memberId));
    }

    // 3. Update transaction record. submittedDate override allowed for
    // back-entry correction.
    //
    // The balanceBefore/balanceAfter snapshot must describe the target fund's
    // cash ACROSS this edit: the balance the fund held before the edit, and
    // the balance it holds after it. The edit applied a NET delta (the fund
    // may be untouched, or credited without ever being debited), so the
    // pre-edit balance is the live post-edit balance minus that delta —
    // never `live - amount`, which would print a negative "before" for a fund
    // that simply holds less cash than this one row is worth (e.g. after a
    // dividend run paid the fund out).
    const [liveFund] = isNowCompleted
      ? await tx
          .select({ balance: funds.balance })
          .from(funds)
          .where(and(eq(funds.id, newFundId), eq(funds.tenantId, tenantId)))
          .limit(1)
      : [];
    const liveFundBalanceCents = isNowCompleted ? toCents(liveFund?.balance ?? '0') : 0;
    const newFundDeltaCents = fundDelta.get(newFundId) ?? 0;
    const { beforeCents: fundBalanceBeforeCents, afterCents: liveAfterCents } = fundBalanceAcrossEdit(
      liveFundBalanceCents,
      newFundDeltaCents,
    );
    const balanceBeforeStr = isNowCompleted ? fmt(fundBalanceBeforeCents) : undefined;
    const balanceAfterStr = isNowCompleted ? fmt(liveAfterCents) : undefined;

    const [updated] = await tx
      .update(transactions)
      .set({
        amount: fmt(newAmountCents),
        fundId: newFundId,
        memberId: newMemberId,
        description: data.description || existing.description || '',
        date: depositDate,
        submittedDate: data.submittedDate ? resolveSubmittedDate(data.submittedDate) : existing.submittedDate ?? undefined,
        status: newStatus,
        depositMethod: data.depositMethod || existing.depositMethod,
        depositMonth: depositMonthKey,
        handlingOfficer: user.name || data.cashierName || existing.handlingOfficer || 'System',
        ...(isNowCompleted
          ? { balanceBefore: balanceBeforeStr, balanceAfter: balanceAfterStr }
          : {}),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Transaction');

    // Month or member may have changed — recompute lastDepositMonth for both
    // affected members from their completed deposits (same rule as revert).
    for (const mid of new Set([oldMemberId, newMemberId])) {
      await tx.execute(sql`
        UPDATE ${members}
        SET last_deposit_month = (
          SELECT MAX(COALESCE(t.deposit_month, to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM')))
          FROM ${transactions} t
          WHERE t.member_id = ${mid}::uuid
            AND t.tenant_id = ${tenantId}::uuid
            AND t.type = 'Deposit'
            AND t.is_deleted = false
            AND t.status IN ('Completed', 'Success')
        )
        WHERE ${members.id} = ${mid}::uuid AND ${members.tenantId} = ${tenantId}::uuid
      `);
    }

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'EDIT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        // `date` joins the value-change trail: re-dating a posted deposit is
        // exactly what a period-close audit looks for.
        previous: { amount: oldAmountCents / 100, fundId: oldFundId, memberId: oldMemberId, status: existing.status, date: existing.date },
        current: { amount: newAmountCents / 100, fundId: newFundId, memberId: newMemberId, status: newStatus, date: depositDate },
      },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: newAmountCents / 100,
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. approveDeposit
// ---------------------------------------------------------------------------

export async function approveDeposit(id: string, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [txn] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId))).for('update').limit(1);
    if (!txn) throw new NotFoundError('Transaction');
    if (txn.status === 'Success' || txn.status === 'Completed') {
      throw new ConflictError('Transaction already approved');
    }
    if (txn.type !== 'Deposit') throw new AppError('Only deposits can be approved', 400, 'INVALID_TYPE');

    const fundId = txn.fundId!;
    const memberId = txn.memberId!;
    const [fund] = await tx.select().from(funds).where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!fund) throw new NotFoundError('Fund');
    const [member] = await tx.select().from(members).where(and(eq(members.id, memberId), eq(members.tenantId, tenantId))).for('update').limit(1);
    if (!member) throw new NotFoundError('Member');
    // A request can outlive a suspension — approving must not credit money
    // to a suspended member (same gate as the native approve route).
    assertMemberNotSuspended(member, 'approving a deposit');

    // §12 one-deposit-per-member-per-month: the final gate — approval credits
    // settled money, so the month must be free of any OTHER occupant (the
    // row being approved is excluded). Month key: stored deposit_month first,
    // collected-date month as fallback (same rule as the native approve
    // route).
    const depositMonthKey = txn.depositMonth || (txn.date ? new Date(txn.date).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7));
    const monthOccupant = await findDepositMonthOccupant(tx, {
      tenantId,
      memberId,
      depositMonthKey,
      excludeId: txn.id,
    });
    if (monthOccupant) {
      throw new AppError(depositMonthConflictMessage(depositMonthKey, monthOccupant), 409, 'DUPLICATE_DEPOSIT');
    }

    const txnCents = toCents(txn.amount);

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric + ${txnCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, fundId));

    await tx
      .update(members)
      .set({ totalContributed: sql`(${members.totalContributed}::numeric + ${txnCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(members.id, memberId));

    const [updated] = await tx
      .update(transactions)
      .set({ status: 'Completed', authorizedBy: user.id, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Transaction');

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'APPROVE_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: { amount: txnCents / 100, previousStatus: txn.status, newStatus: 'Completed' },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: txnCents / 100,
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 4b. revertDeposit — Completed -> PENDING with amount reversal
// ---------------------------------------------------------------------------

export async function revertDeposit(id: string, reason: string, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  if (!reason || reason.trim().length === 0) {
    throw new AppError('A revert reason is required per financial compliance rules', 400, 'REASON_REQUIRED');
  }

  return db.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!txn) throw new NotFoundError('Transaction');
    if (txn.type !== 'Deposit') throw new AppError('Only deposits can be reverted', 400, 'INVALID_TYPE');
    if (txn.isDeleted) throw new AppError('Deleted transactions cannot be reverted. Restore the transaction from the Deleted Transactions view first.', 400, 'ALREADY_DELETED');
    if (txn.status !== 'Completed' && txn.status !== 'Success') {
      throw new AppError('Only completed deposits can be reverted to request', 400, 'INVALID_STATUS');
    }
    if (!txn.fundId || !txn.memberId) throw new AppError('Deposit is missing fund or member linkage', 400, 'INVALID_LINKAGE');

    const txnCents = toCents(txn.amount);

    // Lock fund + member in canonical order (funds then members) to avoid deadlocks.
    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, txn.fundId!), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!fund) throw new NotFoundError('Fund');
    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, txn.memberId!), eq(members.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!member) throw new NotFoundError('Member');

    // Guard: reversal must not drop the fund below its minimum reserve.
    const afterCents = toCents(fund.balance ?? '0') - txnCents;
    const minReserveCents = toCents(fund.minimumBalance ?? '0');
    if (afterCents < minReserveCents) {
      throw new AppError(
        `Cannot revert: reversing ${(txnCents / 100).toFixed(2)} would drop ${fund.name} below minimum reserve`,
        400,
        'FUND_DEFICIT_PREVENTED',
      );
    }

    // Revertible while the member's FREE balance covers the deposit:
    // `totalContributed` is already net of project investment, so 5,000 + 5,000
    // deposited with 1,000 invested leaves 9,000 free and a 5,000 deposit may
    // revert. Only a larger reversal would un-fund a project (§12). The member
    // row is locked above, so a concurrent investment cannot race this check.
    const memberEquityCents = toCents(member.totalContributed ?? '0');
    if (memberEquityCents < txnCents) {
      throw new AppError(
        `Cannot revert: ${member.name ?? 'the member'} only has ${(memberEquityCents / 100).toFixed(2)} of uncommitted deposit balance and this reversal removes ${(txnCents / 100).toFixed(2)}. Wind back the project investment first.`,
        400,
        'INSUFFICIENT_EQUITY',
      );
    }

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric - ${txnCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(and(eq(funds.id, txn.fundId!), eq(funds.tenantId, tenantId)));

    await tx
      .update(members)
      .set({
        totalContributed: sql`(${members.totalContributed}::numeric - ${txnCents / 100})::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(and(eq(members.id, txn.memberId!), eq(members.tenantId, tenantId)));

    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'PENDING',
        description: `${txn.description} — REVERTED: ${reason.trim()}`,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .returning();
    if (!updated) throw new NotFoundError('Transaction');

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'REVERT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        amount: txnCents / 100,
        previousStatus: txn.status,
        newStatus: 'PENDING',
        reason: reason.trim(),
        fundId: txn.fundId,
        memberId: txn.memberId,
      },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: txnCents / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. addExpense
// ---------------------------------------------------------------------------

export async function addExpense(data: ExpenseInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(funds).where(and(eq(funds.id, data.fundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!fund) throw new NotFoundError('Source Fund');

    const projectId = data.projectId || null;
    const amountCents = parsePositiveAmount(data.amount);
    let projectRef: typeof projects.$inferSelect | null = null;
    let balanceBeforeCents = toCents(fund.balance ?? '0');

    if (projectId) {
      projectRef = (await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).for('update').limit(1))[0] ?? null;
      if (!projectRef) throw new NotFoundError('Project');
      if (projectRef.linkedFundId && projectRef.linkedFundId !== data.fundId) {
        throw new AppError(
          'Transactions for this project must be routed through its dedicated project fund.',
          400,
          'LINKED_FUND_MISMATCH',
        );
      }
      balanceBeforeCents = toCents(projectRef.currentFundBalance ?? '0');
    }

    if (!projectId && fund.type === 'PROJECT') {
      throw new AppError(
        'Project-specific funds cannot be used for general expenses. Please select a project first.',
        400,
        'PROJECT_FUND_RESTRICTION',
      );
    }

    if (toCents(fund.balance ?? '0') < amountCents) {
      throw new AppError(`Insufficient balance in ${fund.name}`, 400, 'INSUFFICIENT_BALANCE');
    }

    if (data.memberId) {
      const [expenseMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, data.memberId), eq(members.tenantId, tenantId)))
        .limit(1);
      if (!expenseMember) throw new NotFoundError('Member');
      assertMemberNotSuspended(expenseMember, 'incurring an expense');
    }

    let description = data.description || '';

    if (projectId && projectRef) {
      const projBalanceBeforeCents = toCents(projectRef.currentFundBalance ?? '0');
      const newProjectBalanceCents = projBalanceBeforeCents - amountCents;

      await tx
        .update(projects)
        .set({
          currentFundBalance: sql`(${projects.currentFundBalance}::numeric - ${amountCents / 100})::numeric(15,2)`,
          totalExpenses: sql`(${projects.totalExpenses}::numeric + ${amountCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      await tx.insert(projectUpdates).values({
        projectId,
        type: 'Expense',
        amount: fmt(amountCents),
        description: description || 'Expense',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmt(projBalanceBeforeCents),
        balanceAfter: fmt(newProjectBalanceCents),
      });

      if (description && !description.includes(`[${projectRef.title}]`)) {
        description = `[${projectRef.title}] ${description}`;
      }
    }

    const newFundBalanceCents = toCents(fund.balance ?? '0') - amountCents;
    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric - ${amountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, data.fundId));

    let balanceAfter: string;
    if (projectId) {
      const p = (
        await tx.select({ bal: projects.currentFundBalance }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1)
      )[0];
      balanceAfter = p?.bal || fmt(newFundBalanceCents);
    } else {
      balanceAfter = fmt(newFundBalanceCents);
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Expense',
        amount: fmt(amountCents),
        description,
        category: data.category || 'Operational',
        fundId: data.fundId,
        projectId,
        memberId: data.memberId || null,
        date: data.date ? new Date(data.date) : new Date(),
        status: 'Completed',
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(balanceBeforeCents),
        balanceAfter,
      })
      .returning();
    if (!txn) throw new AppError('Failed to record expense', 500);

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'ADD_EXPENSE',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount: amountCents / 100, fundId: data.fundId, projectId, category: data.category },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: amountCents / 100,
      balanceBefore: balanceBeforeCents / 100,
      balanceAfter: toNum(balanceAfter),
    };
  });
}

// ---------------------------------------------------------------------------
// 6. editExpense
// ---------------------------------------------------------------------------

export async function editExpense(id: string, data: ExpenseInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId))).for('update').limit(1);
    if (!existing) throw new NotFoundError('Transaction');
    if (existing.type !== 'Expense') throw new AppError('Transaction is not an expense', 400, 'INVALID_TYPE');

    const oldAmountCents = toCents(existing.amount);
    const oldFundId = existing.fundId!;
    const oldProjectId = existing.projectId;
    const newAmountCents = parsePositiveAmount(data.amount);
    const newFundId = data.fundId;
    const newProjectId = data.projectId || null;
    let description = data.description || existing.description || '';

    // 1. Revert old impact
    if (oldProjectId) {
      const [proj] = await tx.select().from(projects).where(and(eq(projects.id, oldProjectId), eq(projects.tenantId, tenantId))).for('update').limit(1);
      if (proj) {
        await tx
          .update(projects)
          .set({
            currentFundBalance: sql`(${projects.currentFundBalance}::numeric + ${oldAmountCents / 100})::numeric(15,2)`,
            totalExpenses: sql`GREATEST(0, (${projects.totalExpenses}::numeric - ${oldAmountCents / 100}))::numeric(15,2)`,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, oldProjectId));
      }
    }
    const [oldFund] = await tx.select().from(funds).where(and(eq(funds.id, oldFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (oldFund) {
      await tx
        .update(funds)
        .set({ balance: sql`(${funds.balance}::numeric + ${oldAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
        .where(eq(funds.id, oldFundId));
    }

    // 2. Apply new impact
    if (newProjectId) {
      const [proj] = await tx.select().from(projects).where(and(eq(projects.id, newProjectId), eq(projects.tenantId, tenantId))).for('update').limit(1);
      if (!proj) throw new NotFoundError('New project');
      if (proj.linkedFundId && proj.linkedFundId !== newFundId) {
        throw new AppError(
          'Transactions for this project must be routed through its dedicated project fund.',
          400,
          'LINKED_FUND_MISMATCH',
        );
      }

      const projBalBeforeCents = toCents(proj.currentFundBalance ?? '0');
      const newProjectBalanceCents = projBalBeforeCents - newAmountCents;

      await tx
        .update(projects)
        .set({
          currentFundBalance: sql`(${projects.currentFundBalance}::numeric - ${newAmountCents / 100})::numeric(15,2)`,
          totalExpenses: sql`(${projects.totalExpenses}::numeric + ${newAmountCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, newProjectId));

      await tx.insert(projectUpdates).values({
        projectId: newProjectId,
        type: 'Expense',
        amount: fmt(newAmountCents),
        description: description || 'Expense',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmt(projBalBeforeCents),
        balanceAfter: fmt(newProjectBalanceCents),
      });

      if (description && !description.includes(`[${proj.title}]`)) {
        description = `[${proj.title}] ${description}`;
      }
    }

    const [newFund] = await tx.select().from(funds).where(and(eq(funds.id, newFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!newFund) throw new NotFoundError('Source fund');

    if (!newProjectId && newFund.type === 'PROJECT') {
      throw new AppError('Project-specific funds cannot be used for general expenses. Select a general fund, or record the expense against the linked project instead.', 400, 'PROJECT_FUND_RESTRICTION');
    }

    if (toCents(newFund.balance ?? '0') < newAmountCents) {
      throw new AppError(`Insufficient balance in ${newFund.name}`, 400, 'INSUFFICIENT_BALANCE');
    }

    // Re-pointing the expense at a suspended member is the same "adding a
    // suspended member to an operation" as the create path — block it.
    if (data.memberId) {
      const [expenseMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, data.memberId), eq(members.tenantId, tenantId)))
        .limit(1);
      if (!expenseMember) throw new NotFoundError('Member');
      assertMemberNotSuspended(expenseMember, 'incurring an expense');
    }

    // Editing the posting date must clear the same guards as creating (no
    // junk, no future postings) — and lands in the audit trail below.
    const newDate = data.date ? resolveDepositDate(data.date) : existing.date;

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric - ${newAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, newFundId));

    const [updated] = await tx
      .update(transactions)
      .set({
        amount: fmt(newAmountCents),
        fundId: newFundId,
        projectId: newProjectId,
        memberId: data.memberId || existing.memberId,
        description,
        category: data.category || existing.category,
        date: newDate,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Transaction');

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'EDIT_EXPENSE',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        // Date changes join the value-change trail (see EDIT_DEPOSIT).
        previous: { amount: oldAmountCents / 100, fundId: oldFundId, projectId: oldProjectId, date: existing.date },
        current: { amount: newAmountCents / 100, fundId: newFundId, projectId: newProjectId, date: newDate },
      },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: newAmountCents / 100,
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 7. addEarning
// ---------------------------------------------------------------------------

export async function addEarning(data: EarningInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(funds).where(and(eq(funds.id, data.fundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!fund) throw new NotFoundError('Target Fund');

    const amountCents = parsePositiveAmount(data.amount);
    const projectId = data.projectId || null;
    let balanceBeforeCents = toCents(fund.balance ?? '0');
    let projectRef: typeof projects.$inferSelect | null = null;

    if (projectId) {
      projectRef = (await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).for('update').limit(1))[0] ?? null;
      if (!projectRef) throw new NotFoundError('Project');
      if (projectRef.linkedFundId && projectRef.linkedFundId !== data.fundId) {
        throw new AppError(
          'Transactions for this project must be routed through its dedicated project fund.',
          400,
          'LINKED_FUND_MISMATCH',
        );
      }
      balanceBeforeCents = toCents(projectRef.currentFundBalance ?? '0');
    }

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, data.fundId));

    const newFundBalanceCents = toCents(fund.balance ?? '0') + amountCents;
    let balanceAfter = fmt(newFundBalanceCents);

    if (projectId && projectRef) {
      const projBalanceBeforeCents = toCents(projectRef.currentFundBalance ?? '0');
      const newProjectBalanceCents = projBalanceBeforeCents + amountCents;

      await tx
        .update(projects)
        .set({
          currentFundBalance: sql`(${projects.currentFundBalance}::numeric + ${amountCents / 100})::numeric(15,2)`,
          totalEarnings: sql`(${projects.totalEarnings}::numeric + ${amountCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      await tx.insert(projectUpdates).values({
        projectId,
        type: 'Earning',
        amount: fmt(amountCents),
        description: data.description || 'General Earning',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmt(projBalanceBeforeCents),
        balanceAfter: fmt(newProjectBalanceCents),
      });

      balanceAfter = fmt(newProjectBalanceCents);
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Earning',
        amount: fmt(amountCents),
        description: data.description || 'General Earning',
        category: data.category || 'Income',
        fundId: data.fundId,
        projectId,
        date: data.date ? new Date(data.date) : new Date(),
        status: 'Completed',
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(balanceBeforeCents),
        balanceAfter,
      })
      .returning();
    if (!txn) throw new AppError('Failed to record earning', 500);

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'ADD_EARNING',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount: amountCents / 100, fundId: data.fundId, projectId, category: data.category },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: amountCents / 100,
      balanceBefore: balanceBeforeCents / 100,
      balanceAfter: toNum(balanceAfter),
    };
  });
}

// ---------------------------------------------------------------------------
// 8. deleteTransaction — soft delete only (§12)
// ---------------------------------------------------------------------------

export async function deleteTransaction(
  id: string,
  reason: string | undefined,
  user: SessionUser,
) {
  const tenantId = requireTenant(user);
  const db = getDb();

  const deletedAmountCents = await db.transaction(async (tx) => {
    // Lock the row so two concurrent deletes cannot both pass the isDeleted
    // guard and reverse the fund balance twice (§12: no money duplication).
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!txn) throw new NotFoundError('Transaction');
    if (txn.isDeleted) throw new AppError('Transaction is already deleted', 400, 'ALREADY_DELETED');

    const isPrivileged =
      user.role === 'Admin' ||
      user.role === 'Administrator' ||
      user.role === 'Manager' ||
      user.permissions?.['DEPOSITS'] === 'WRITE';
    if (!isPrivileged && txn.type === 'Deposit' && txn.status === 'Pending') {
      const [userMember] = await tx
        .select({ id: members.id, memberId: members.memberId })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), or(eq(members.userId, user.id), eq(members.id, user.memberId || ''))))
        .limit(1);

      const userMemberId = userMember?.id || user.memberId;
      const isOwner = (userMemberId && txn.memberId === userMemberId) || txn.createdBy === user.id;
      if (!isOwner) throw new ForbiddenError('You can only cancel or delete your own deposit request');
    }

    const txnCents = toCents(txn.amount);
    const txnFundId = txn.fundId;
    const txnProjectId = txn.projectId;
    const txnMemberId = txn.memberId;
    const deletionReason = reason || 'Manual Deletion';

    if (txn.status === 'Success' || txn.status === 'Completed') {
      // 1. Reverse fund balance. The direction comes from the canonical
      //    ledger classifier (lib/transaction-reversal) rather than a
      //    hand-maintained type list, so this path can never drift from the
      //    writers that created the movement (and matches the
      //    DELETE /api/transactions/[id] route). A settled deposit is owned by
      //    the revert route and must not be deleted here.
      const reversal = decideReversal({
        type: txn.type,
        status: txn.status,
        fundId: txnFundId,
        amount: txn.amount,
      });
      if (reversal.requiresRevertPath) {
        throw new AppError(reversal.revertHint ?? 'Use the revert path for this transaction', 400, 'REVERT_REQUIRED');
      }
      if (reversal.fundId && reversal.direction !== 0 && txnCents > 0) {
        // Lock the fund row, then apply the signed delta with atomic SQL — a
        // concurrent deposit/expense must never lose this reversal (§12).
        const [fund] = await tx
          .select()
          .from(funds)
          .where(and(eq(funds.id, reversal.fundId), eq(funds.tenantId, tenantId)))
          .for('update')
          .limit(1);
        if (fund) {
          const deltaCents = reversal.direction * txnCents;
          if (deltaCents < 0) {
            const afterCents = toCents(fund.balance ?? '0') + deltaCents;
            const minReserveCents = toCents(fund.minimumBalance ?? '0');
            if (afterCents < minReserveCents) {
              throw new AppError(
                `Cannot delete transaction: reversing ${(txnCents / 100).toFixed(2)} would drop ${fund.name} balance below minimum reserve`,
                400,
                'FUND_DEFICIT_PREVENTED',
              );
            }
          }
          await tx
            .update(funds)
            .set({
              balance: sql`(${funds.balance}::numeric + ${deltaCents / 100})::numeric(15,2)`,
              updatedAt: new Date(),
            })
            .where(and(eq(funds.id, reversal.fundId), eq(funds.tenantId, tenantId)));
        }
      }

      // 2. Recompute member totalContributed from remaining deposits
      if (txnMemberId && txn.type === 'Deposit') {
        const result = (await tx.execute(
          sql`SELECT COALESCE(SUM(amount::numeric), 0) as total
              FROM transactions
              WHERE member_id = ${txnMemberId}
                AND tenant_id = ${tenantId}
                AND type = 'Deposit'
                AND status IN ('Completed', 'Success')
                AND is_deleted = false
                AND id != ${id}`,
        )) as unknown as Array<{ total: string }>;
        const totalRemaining = toNum(result[0]?.total || 0);
        await tx
          .update(members)
          .set({ totalContributed: fromCents(Math.round(totalRemaining * 100)), updatedAt: new Date() })
          .where(and(eq(members.id, txnMemberId), eq(members.tenantId, tenantId)));
      }

      // 3. Reverse project tracking
      if (txnProjectId) {
        // Lock the project row so a concurrent project expense/earning cannot
        // interleave its read-modify-write with this reversal (§12).
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, txnProjectId), eq(projects.tenantId, tenantId)))
          .for('update')
          .limit(1);
        if (project) {
          let balAdjCents = 0;
          let earnAdjCents = 0;
          let expAdjCents = 0;

          if (txn.type === 'Earning') {
            balAdjCents = -txnCents;
            earnAdjCents = -txnCents;
          } else if (txn.type === 'Expense') {
            balAdjCents = txnCents;
            expAdjCents = -txnCents;
          } else if (txn.type === 'Investment') {
            balAdjCents = -txnCents;
          } else if (txn.type === 'Withdrawal') {
            balAdjCents = txnCents;
          }

          await tx
            .update(projects)
            .set({
              currentFundBalance: fmt(toCents(project.currentFundBalance ?? '0') + balAdjCents),
              totalEarnings: fmt(Math.max(0, toCents(project.totalEarnings ?? '0') + earnAdjCents)),
              totalExpenses: fmt(Math.max(0, toCents(project.totalExpenses ?? '0') + expAdjCents)),
              updatedAt: new Date(),
            })
            .where(and(eq(projects.id, txnProjectId), eq(projects.tenantId, tenantId)));
        }
      }
    }

    // 4. Archive
    await tx.insert(deletedRecords).values({
      originalId: id,
      collectionName: 'Transaction',
      data: txn as unknown as Record<string, unknown>,
      reason: deletionReason,
      deletedBy: user.id,
      deletedAt: new Date(),
    });

    // 5. Soft delete
    await tx
      .update(transactions)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: user.id,
        deletionReason,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)));

    // 6. Audit
    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'DELETE_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: id,
      details: { originalAmount: txnCents / 100, reason: deletionReason, type: txn.type },
      status: 'SUCCESS',
    });

    return txnCents;
  });

  return { deletedAmount: deletedAmountCents / 100, message: 'Transaction deleted and archived to deleted records' };
}

// ---------------------------------------------------------------------------
// 9. transferFunds — double-entry inter-fund transfer
// ---------------------------------------------------------------------------

export async function transferFunds(data: TransferInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  if (data.sourceFundId === data.targetFundId) {
    throw new AppError('Source and target funds must be different', 400, 'SAME_FUND');
  }

  return db.transaction(async (tx) => {
    // Canonical sorted locking order prevents PostgreSQL deadlocks on
    // concurrent bidirectional transfers. Written as an explicit tuple destructure
    // rather than Array#sort so noUncheckedIndexedAccess does not widen both
    // ids to `string | undefined`.
    const { sourceFundId, targetFundId } = data;
    const [firstId, secondId]: [string, string] =
      sourceFundId < targetFundId ? [sourceFundId, targetFundId] : [targetFundId, sourceFundId];
    const [fundA] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, firstId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    const [fundB] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, secondId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);

    const sourceFund = firstId === sourceFundId ? fundA : fundB;
    const targetFund = firstId === targetFundId ? fundA : fundB;

    if (!sourceFund) throw new NotFoundError('Source fund');
    if (!targetFund) throw new NotFoundError('Target fund');

    if (sourceFund.currency && targetFund.currency && sourceFund.currency !== targetFund.currency) {
      throw new AppError('Cannot transfer between funds with different currencies. Choose a destination fund in the same currency as the source.', 400, 'CURRENCY_MISMATCH');
    }

    const amountCents = parsePositiveAmount(data.amount);
    if (toCents(sourceFund.balance ?? '0') < amountCents) {
      const gap = (amountCents - toCents(sourceFund.balance ?? '0')) / 100;
      throw new AppError(`Insufficient funds in ${sourceFund.name}. Gap: ${gap.toFixed(2)}`, 400, 'INSUFFICIENT_BALANCE');
    }

    // Fund governance: enforce minimum balance reserve
    const sourceMinBalanceCents = toCents(sourceFund.minimumBalance ?? '0');
    const sourceAfterTransferCents = toCents(sourceFund.balance ?? '0') - amountCents;
    if (sourceAfterTransferCents < sourceMinBalanceCents) {
      throw new AppError(
        `Transfer would drop ${sourceFund.name} below its minimum reserve of ${fromCents(sourceMinBalanceCents)}`,
        400,
        'MINIMUM_BALANCE',
      );
    }

    const sourceBalBeforeCents = toCents(sourceFund.balance ?? '0');
    const targetBalBeforeCents = toCents(targetFund.balance ?? '0');
    const newSourceBalanceCents = sourceBalBeforeCents - amountCents;
    const newTargetBalanceCents = targetBalBeforeCents + amountCents;

    // One clock for the whole operation: `date` is the effective transfer day
    // (user-selected, defaults to now); operationTime is when it was recorded
    // and becomes createdAt/updatedAt on the legs.
    const operationTime = new Date();
    const transferDate = resolveTransferDate(data.date, operationTime);

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric - ${amountCents / 100})::numeric(15,2)`, updatedAt: operationTime })
      .where(eq(funds.id, data.sourceFundId));

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`, updatedAt: operationTime })
      .where(eq(funds.id, data.targetFundId));

    const refNumber = data.referenceNumber || `TRF-${Date.now()}-${data.sourceFundId.slice(0, 4)}-${data.targetFundId.slice(0, 4)}`;
    // Hard, queryable link pairing the two legs — survives reference-number
    // edits and lets the ledger reconstruct the full trail of one transfer.
    const transferGroupId = crypto.randomUUID();

    const [sourceTx] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Transfer Out',
        amount: fmt(amountCents),
        description: `[Transfer OUT] to ${targetFund.name}: ${data.description || ''}`,
        referenceNumber: `${refNumber}-OUT`,
        transferGroupId,
        fundId: data.sourceFundId,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(sourceBalBeforeCents),
        balanceAfter: fmt(newSourceBalanceCents),
        status: 'Completed',
        date: transferDate,
        createdAt: operationTime,
        updatedAt: operationTime,
      })
      .returning();

    const [targetTx] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Transfer In',
        amount: fmt(amountCents),
        description: `[Transfer IN] from ${sourceFund.name}: ${data.description || ''}`,
        referenceNumber: `${refNumber}-IN`,
        transferGroupId,
        fundId: data.targetFundId,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(targetBalBeforeCents),
        balanceAfter: fmt(newTargetBalanceCents),
        status: 'Completed',
        date: transferDate,
        createdAt: operationTime,
        updatedAt: operationTime,
      })
      .returning();
    if (!sourceTx || !targetTx) throw new AppError('Failed to record fund transfer', 500);

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'FUND_TRANSFER',
      resourceType: 'Fund',
      resourceId: data.targetFundId,
      details: {
        amount: amountCents / 100,
        source: data.sourceFundId,
        target: data.targetFundId,
        transferDate: transferDate.toISOString(),
        sourceTxId: sourceTx.id,
        targetTxId: targetTx.id,
      },
      status: 'SUCCESS',
    });

    return {
      sourceTx: { ...sourceTx, amount: amountCents / 100 },
      targetTx: { ...targetTx, amount: amountCents / 100 },
    };
  });
}

// ---------------------------------------------------------------------------
// 11. transferEquity
// ---------------------------------------------------------------------------

// Ledger narrations are stored as canonical English and localized at render
// time (lib/ledger-description.ts). Storing them in the actor's UI language
// instead would freeze one language into the books and break every reader
// after a language switch — the same row must read correctly in all four
// locales, including rows written long before the reader chose a language.
export async function transferEquity(data: EquityTransferInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  const batchId =
    (typeof data.referenceNumber === 'string' && data.referenceNumber.trim)
      ? data.referenceNumber.trim()
      : `EQT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  return db.transaction(async (tx) => {
    // Lock every row this run touches, in deterministic uuid order, before any
    // of them is read. Without the locks two concurrent divisions of the same
    // holder could both pass the share and balance checks against stale values
    // and move the same equity twice.
    const involvedIds = [data.fromMemberId, ...data.transfers.map((t) => t.toMemberId)].sort();
    for (const id of involvedIds) {
      await tx.execute(
        sql`SELECT id FROM ${members} WHERE id = ${id}::uuid AND tenant_id = ${tenantId} FOR UPDATE`,
      );
    }

    // Idempotency (§12): a retried batch with the same reference must not move
    // the money twice. Checked under the row locks, so a racing duplicate
    // serializes behind this run instead of slipping through.
    const [duplicate] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.referenceNumber, `${batchId}-FROM`),
          eq(transactions.isDeleted, false),
          eq(transactions.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (duplicate) throw new ConflictError('An equity transfer with this reference has already been recorded');

    const lockedMembers = await tx
      .select()
      .from(members)
      .where(and(inArray(members.id, involvedIds), eq(members.tenantId, tenantId)));
    const memberById = new Map(lockedMembers.map((m) => [m.id, m]));

    const sourceMember = memberById.get(data.fromMemberId);
    if (!sourceMember) throw new NotFoundError('Source member');
    // A suspended holder settles through the exit path, not by pushing shares
    // out while frozen.
    if (sourceMember.status !== 'active') {
      throw new AppError(`Member ${sourceMember.name} is ${sourceMember.status} and cannot transfer equity. Reactivate the member in the Members screen first.`, 400, 'SOURCE_NOT_ACTIVE');
    }

    const transfers = data.transfers.map((t) => ({
      toMemberId: t.toMemberId,
      amountCents: t.amount ? parsePositiveAmount(t.amount) : 0,
      shares: assertIntegralShares(t.shares ?? 0, 'transfers.shares'),
    }));

    // Shares without contribution are a gift: require the explicit flag rather
    // than treating an empty amount as an implicit one.
    const giftedShares = transfers.filter((t) => t.amountCents === 0 && t.shares > 0);
    if (giftedShares.length > 0 && data.giftAcknowledged !== true) {
      throw new AppError(
        'Transferring shares without their contribution balance gives the recipient a claim on future surplus they did not fund. Acknowledge this as a gift to continue.',
        400,
        'GIFT_ACKNOWLEDGEMENT_REQUIRED',
      );
    }

    // The mirror case: contribution without shares. The recipient's equity
    // grows while their ownership of the pool does not, so this too has to be
    // an acknowledged movement rather than an accidentally filled row.
    const amountOnlyRows = transfers.filter((t) => t.amountCents > 0 && t.shares === 0);
    if (amountOnlyRows.length > 0 && data.amountOnlyAcknowledged !== true) {
      throw new AppError(
        'Transferring contribution without shares changes the recipient\'s equity balance but not their ownership. Acknowledge this as an amount-only transfer to continue.',
        400,
        'AMOUNT_ONLY_ACKNOWLEDGEMENT_REQUIRED',
      );
    }

    const totalBeingTransferredCents = transfers.reduce((sum, t) => sum + t.amountCents, 0);
    const totalSharesTransferred = transfers.reduce((sum, t) => sum + Number(t.shares || 0), 0);

    if (totalBeingTransferredCents > toCents(sourceMember.totalContributed ?? '0')) {
      throw new AppError(
        `Insufficient contribution balance. Transfer: ${fromCents(totalBeingTransferredCents)}, Owned: ${sourceMember.totalContributed}`,
        400,
        'INSUFFICIENT_BALANCE',
      );
    }
    if (totalSharesTransferred > Number(sourceMember.shares)) {
      throw new AppError(
        `Insufficient shares. Transfer: ${totalSharesTransferred}, Owned: ${Number(sourceMember.shares)}`,
        400,
        'INSUFFICIENT_SHARES',
      );
    }

    const recipientIds = transfers.map((t) => t.toMemberId);
    if (new Set(recipientIds).size !== recipientIds.length) {
      // Two rows to one member would each be computed from the same locked
      // base value and the second would silently overwrite the first.
      throw new AppError('A recipient can appear only once per transfer', 400, 'DUPLICATE_RECIPIENT');
    }

    const now = new Date();
    const recipientValues: Array<typeof transactions.$inferInsert> = [];

    for (const t of transfers) {
      if (t.toMemberId === data.fromMemberId) {
        throw new AppError('Self-transfer of equity is not permitted', 400, 'SELF_TRANSFER');
      }

      const targetMember = memberById.get(t.toMemberId);
      if (!targetMember) throw new NotFoundError('Target member');
      if (targetMember.status !== 'active') {
        throw new AppError(`Target member ${targetMember.name} is not active`, 400, 'INACTIVE_TARGET');
      }

      const targetNewContributedCents = toCents(targetMember.totalContributed ?? '0') + t.amountCents;
      const targetNewShares = Number(targetMember.shares) + t.shares;

      await tx
        .update(members)
        .set({ totalContributed: fmt(targetNewContributedCents), shares: targetNewShares, updatedAt: now })
        .where(and(eq(members.id, t.toMemberId), eq(members.tenantId, tenantId)));

      // These rows previously carried no tenantId, which made every
      // tenant-scoped ledger query blind to a completed equity movement.
      recipientValues.push({
        tenantId,
        type: 'Equity-Transfer',
        amount: fmt(t.amountCents),
        description: `Equity Migration: Received from ${sourceMember.name} [Reference: ${data.reason}]`,
        memberId: t.toMemberId,
        date: now,
        status: 'Completed',
        referenceNumber: `${batchId}-TO-${t.toMemberId}`,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
      });
    }

    if (recipientValues.length > 0) {
      await tx.insert(transactions).values(recipientValues);
    }

    const sourceNewContributedCents = Math.max(0, toCents(sourceMember.totalContributed ?? '0') - totalBeingTransferredCents);
    const sourceNewShares = Math.max(0, Number(sourceMember.shares) - totalSharesTransferred);

    const updateData: Partial<typeof members.$inferInsert> & { updatedAt: Date } = {
      totalContributed: fmt(sourceNewContributedCents),
      shares: sourceNewShares,
      updatedAt: now,
    };

    if (sourceNewContributedCents === 0 && sourceNewShares === 0) {
      updateData.status = 'inactive';
      // Record WHY the member is inactive. Zero equity + zero shares is not a
      // deposit hold, and the governance sweep (which only reads `status`)
      // must not auto-restore this member on its next run — the reason is what
      // tells the two apart.
      updateData.statusReason = 'EQUITY_TRANSFERRED_OUT';
    }

    await tx.update(members).set(updateData).where(and(eq(members.id, data.fromMemberId), eq(members.tenantId, tenantId)));

    await tx.insert(transactions).values({
      tenantId,
      type: 'Equity-Transfer',
      amount: fmt(totalBeingTransferredCents),
      description: `Equity Migration: Transferred to ${transfers.length} recipient(s) [Reference: ${data.reason}]`,
      memberId: data.fromMemberId,
      date: now,
      status: 'Completed',
      // The -FROM suffix is what the idempotency check above looks for, so the
      // debit row is the batch's identity marker as well as its ledger entry.
      referenceNumber: `${batchId}-FROM`,
      authorizedBy: user.id,
      createdBy: user.id,
      updatedBy: user.id,
      handlingOfficer: user.name,
    });

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'TRANSFER_EQUITY',
      resourceType: 'Member',
      resourceId: data.fromMemberId,
      details: {
        batchId,
        from: sourceMember.name,
        // Amounts are exact decimal strings, not float divisions — this record
        // is the evidence trail for a capital movement.
        totalAmount: fromCents(totalBeingTransferredCents),
        totalShares: totalSharesTransferred,
        sourceSharesBefore: Number(sourceMember.shares),
        sourceSharesAfter: sourceNewShares,
        recipients: transfers.map((t) => {
          const target = memberById.get(t.toMemberId);
          return {
            id: t.toMemberId,
            name: target?.name ?? '',
            amount: fromCents(t.amountCents),
            shares: t.shares,
            // Makes an unfunded share movement explicit in the audit trail.
            gift: t.amountCents === 0 && t.shares > 0,
            // ...and the mirror: equity moved with no ownership change.
            amountOnly: t.amountCents > 0 && t.shares === 0,
            sharesBefore: Number(target?.shares ?? 0),
            sharesAfter: Number(target?.shares ?? 0) + t.shares,
          };
        }),
        reason: data.reason,
      },
      status: 'SUCCESS',
    });

    return { batchId, message: 'Equity transfer completed successfully' };
  });
}

// ---------------------------------------------------------------------------
// 12. reconcileFund — ledger-derived balance check
// ---------------------------------------------------------------------------

export async function reconcileFund(fundId: string, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();
  const rawSql = getSql();

  const [fund] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
    .limit(1);
  if (!fund) throw new NotFoundError('Fund');

  // The type lists below must mirror exactly the transaction types that
  // actually move `funds.balance` (see addDeposit/addExpense/addEarning/
  // transferFunds/projects route/dividend route). A type that credited or
  // debited the fund but is missing here makes the fund report a permanent
  // false DISCREPANCY; a type that never moved the fund makes it over-count.
  // 'Dividend Distribution' is deliberately absent: it is the run-level
  // informational row, while the real debit is the per-member 'Dividend' rows
  // plus the 'Transfer Out' reserve sweep. Statuses match the shared settled
  // set ('Completed', 'Success') used everywhere else in the ledger.
  const txSummary = await rawSql<{ total_in: string; total_out: string }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment', 'Project Investment', 'Transfer In', 'Statutory Reserve') THEN amount::numeric ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend', 'Disbursement', 'Transfer Out') THEN amount::numeric ELSE 0 END), 0) as total_out
    FROM transactions
    WHERE fund_id = ${fund.id}
      AND tenant_id = ${tenantId}
      AND status IN ('Completed', 'Success')
      AND is_deleted = false
  `;

  const stats = txSummary[0] || { total_in: '0', total_out: '0' };
  const calculatedBalanceCents = toCents(stats.total_in) - toCents(stats.total_out);
  const actualBalanceCents = toCents(fund.balance ?? '0');
  let isMatched = Math.abs(calculatedBalanceCents - actualBalanceCents) < 1; // < 1 cent
  let projectMismatch = false;

  if (fund.linkedProjectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, fund.linkedProjectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (project && Math.abs(actualBalanceCents - toCents(project.currentFundBalance ?? '0')) >= 1) {
      isMatched = false;
      projectMismatch = true;
    }
  }

  await db
    .update(funds)
    .set({
      lastReconciledAt: new Date(),
      reconciliationStatus: isMatched ? 'VERIFIED' : 'DISCREPANCY',
      updatedAt: new Date(),
    })
    .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)));

  // A reconciliation is a control action: who verified a fund, and against
  // what numbers, must be reconstructable after the fact.
  await db.insert(auditLogs).values({
    userId: user.id,
    userName: user.name,
    tenantId,
    action: 'RECONCILE_FUND',
    resourceType: 'Fund',
    resourceId: fundId,
    details: {
      fund: fund.name,
      ledgerBalance: (calculatedBalanceCents / 100).toFixed(2),
      recordedBalance: (actualBalanceCents / 100).toFixed(2),
      result: isMatched ? 'VERIFIED' : 'DISCREPANCY',
      projectMismatch,
    },
    status: 'SUCCESS',
  });

  return {
    fund: fund.name,
    actualBalance: actualBalanceCents / 100,
    calculatedBalance: calculatedBalanceCents / 100,
    isMatched,
    inflow: toCents(stats.total_in) / 100,
    outflow: toCents(stats.total_out) / 100,
    discrepancy: (calculatedBalanceCents - actualBalanceCents) / 100,
    projectMismatch,
  };
}

// ---------------------------------------------------------------------------
// 13. bulkAddDeposits — idempotent batch (unique per-row references)
// ---------------------------------------------------------------------------

export function bulkDepositReference(batchId: string, rowIndex: number): string {
  return `${batchId}-${String(rowIndex + 1).padStart(3, '0')}`;
}

/**
 * The month a bulk row is FOR: the row's own `depositMonth` wins, else the
 * batch's `commonMonth`.
 *
 * A row that resolves NO month is refused instead of falling back to the
 * collected date. The multi-member batch always sends a common month, so the
 * fallback was unreachable until the single-member, multi-month collection
 * started sending a month per row — and "post it against today's month" is
 * exactly the silent mis-period the desk must never see (§8: the accounting
 * period is an explicit choice).
 */
function resolveBatchRowMonth(row: { depositMonth?: string }, commonMonth?: string): string {
  const month = row.depositMonth || commonMonth || '';
  if (!month) {
    throw new AppError(
      "[Field 'depositMonth', Code: required] Every bulk deposit row needs a deposit month",
      400,
      'VALIDATION_ERROR',
    );
  }
  return month;
}

export async function bulkAddDeposits(data: BulkDepositInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, data.fundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!fund) throw new NotFoundError('Target fund');
    if (!isDepositFund(fund)) throw new AppError(DEPOSIT_FUND_REQUIRED_MESSAGE, 400, 'INVALID_FUND_TYPE');

    const batchId = `BLK-${data.requestKey ?? crypto.randomUUID()}`;
    const rowReferences = data.deposits.map((_, index) => bulkDepositReference(batchId, index));
    const seenEntries = new Set<string>();
    const memberIds = data.deposits.map((d) => d.memberId);

    for (const dep of data.deposits) {
      const month = resolveBatchRowMonth(dep, data.commonMonth);
      const entryKey = `${dep.memberId}-${month}`;
      if (seenEntries.has(entryKey)) {
        throw new AppError(
          `Duplicate entry detected: Member ID ${dep.memberId} is already in this batch for ${month}`,
          400,
          'DUPLICATE_BATCH',
        );
      }
      seenEntries.add(entryKey);
    }

    const memberRows = await tx
      .select()
      .from(members)
      .where(and(inArray(members.id, memberIds), eq(members.tenantId, tenantId)))
      .for('update');
    const memberMap = new Map(memberRows.map((m) => [m.id, m]));

    // The fund lock serializes retries for this fund. If the first request committed
    // but its response was lost, an identical retry returns the original result.
    const existingBatchRows = await tx
      .select({
        id: transactions.id,
        referenceNumber: transactions.referenceNumber,
        type: transactions.type,
        amount: transactions.amount,
        memberId: transactions.memberId,
        fundId: transactions.fundId,
        date: transactions.date,
        status: transactions.status,
        depositMethod: transactions.depositMethod,
        depositMonth: transactions.depositMonth,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.isDeleted, false),
          inArray(transactions.referenceNumber, rowReferences),
        ),
      );

    if (existingBatchRows.length > 0) {
      const existingByReference = new Map(existingBatchRows.map((row) => [row.referenceNumber, row]));
      const results: Array<{ member: string; amount: number; txId?: string }> = [];
      let totalAmountCents = 0;
      let matches = existingBatchRows.length === data.deposits.length;

      for (const [index, dep] of data.deposits.entries()) {
        const existing = existingByReference.get(bulkDepositReference(batchId, index));
        const amountCents = parsePositiveAmount(dep.amount);
        const month = resolveBatchRowMonth(dep, data.commonMonth);
        const depositDate = resolveDepositDate(dep.date, month);
        const monthKey = resolveDepositMonthKey(month, depositDate, await tenantTimezone(tenantId));
        const member = memberMap.get(dep.memberId);
        totalAmountCents += amountCents;

        matches &&=
          !!existing &&
          existing.type === 'Deposit' &&
          existing.status === 'Completed' &&
          existing.memberId === dep.memberId &&
          existing.fundId === data.fundId &&
          toCents(existing.amount) === amountCents &&
          existing.depositMonth === monthKey &&
          existing.depositMethod === (data.depositMethod || 'Cash') &&
          existing.date?.toISOString() === depositDate.toISOString();

        results.push({
          member: member?.name ?? dep.memberId,
          amount: amountCents / 100,
          txId: existing?.id,
        });
      }

      if (!matches) {
        throw new ConflictError(
          'This bulk deposit request key was already used for different data.',
          'IDEMPOTENCY_KEY_REUSED',
        );
      }

      return {
        batchId,
        totalAmount: totalAmountCents / 100,
        count: data.deposits.length,
        results,
        replayed: true,
      };
    }

    const [paymentSettings] = await tx
      .select({ paymentMethods: systemSettings.paymentMethods })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, tenantId))
      .limit(1);
    if (!isAllowedDepositMethod(data.depositMethod ?? null, normalizePaymentMethods(paymentSettings?.paymentMethods))) {
      throw new AppError(
        "[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first",
        400,
        'VALIDATION_ERROR',
      );
    }

    let totalBatchAmountCents = 0;
    const runningFundBalanceCents = toCents(fund.balance ?? '0');
    const txnInserts: Array<typeof transactions.$inferInsert> = [];
    const memberContributions = new Map<string, number>();
    const memberLastMonth = new Map<string, string>();
    const batchSubmittedDate = new Date();
    const results: Array<{ member: string; amount: number; txId?: string }> = [];
    // §12: every distinct posting date must land in an OPEN fiscal period.
    // Deduped so a single-month batch takes the advisory lock once.
    const fiscalCheckedDates = new Set<string>();
    // Distinct accounting months this batch posts into — one for a multi-member
    // collection, up to twelve for a single member's fiscal year. Recorded in
    // the audit trail so the batch is traceable to its periods.
    const batchMonths = new Set<string>();

    for (const [rowIndex, dep] of data.deposits.entries()) {
      const member = memberMap.get(dep.memberId);
      if (!member) throw new AppError(`Member with ID ${dep.memberId} not found`, 404, 'MEMBER_NOT_FOUND');
      assertMemberNotSuspended(member, 'recording a bulk deposit');

      const depositAmountCents = parsePositiveAmount(dep.amount);
      const month = resolveBatchRowMonth(dep, data.commonMonth);
      const depositDate = resolveDepositDate(dep.date, month);
      const dateKey = depositDate.toISOString();
      if (!fiscalCheckedDates.has(dateKey)) {
        fiscalCheckedDates.add(dateKey);
        await assertFiscalPeriodOpen(fiscalGuardTx(tx), tenantId, depositDate);
      }
      // The explicitly selected month wins for the deposit-month record,
      // duplicate checks and lastDepositMonth; the resolved collected date
      // remains the ledger date (§12 accuracy — month ≠ collection day).
      const monthKey = resolveDepositMonthKey(month, depositDate, await tenantTimezone(tenantId));
      batchMonths.add(monthKey);

      // Duplicate deposit check for the month the deposit is FOR (stored
      // month first, collected-date month for legacy rows without one).
      // Canonical one-per-month rule: ANY fund (a member may not split one
      // month across two containers), settled deposits AND pending requests
      // both occupy the month. Member rows are locked FOR UPDATE above, so
      // concurrent batches serialize on this check; the seenEntries set
      // covers within-batch duplicates (the single batch insert at the end
      // is not yet visible to earlier iterations).
      // Dual-drizzle bridge (same rationale as fiscalGuardTx): the shared
      // condition is built on the root drizzle instance, this service runs
      // on the server instance — runtime-compatible, only the TS generics
      // differ.
      const [existingDeposit] = await tx
        .select({
          id: transactions.id,
          memberId: transactions.memberId,
          status: transactions.status,
          category: transactions.category,
          referenceNumber: transactions.referenceNumber,
        })
        .from(transactions)
        .where(
          depositMonthOccupiedCondition({
            tenantId,
            memberId: dep.memberId,
            depositMonthKey: monthKey,
          }) as unknown as SQL,
        )
        .limit(1);

      if (existingDeposit) {
        throw new AppError(
          `Duplicate deposit detected: Member ${member.name} already has a deposit in ${monthKey} (Transaction ID: ${existingDeposit.id}). ${depositMonthConflictMessage(monthKey, existingDeposit)}`,
          409,
          'DUPLICATE_DEPOSIT',
        );
      }

      const balanceBeforeCents = runningFundBalanceCents + totalBatchAmountCents;
      const balanceAfterCents = balanceBeforeCents + depositAmountCents;
      totalBatchAmountCents += depositAmountCents;

      txnInserts.push({
        tenantId,
        type: 'Deposit',
        amount: fmt(depositAmountCents),
        description: `Bulk Deposit [${monthKey}]`,
        memberId: dep.memberId,
        fundId: data.fundId,
        date: depositDate,
        submittedDate: batchSubmittedDate,
        status: 'Completed',
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name || data.cashierName || 'System',
        depositMethod: data.depositMethod || 'Cash',
        depositMonth: monthKey || null,
        referenceNumber: bulkDepositReference(batchId, rowIndex),
        balanceBefore: fmt(balanceBeforeCents),
        balanceAfter: fmt(balanceAfterCents),
      });

      memberContributions.set(dep.memberId, (memberContributions.get(dep.memberId) || 0) + depositAmountCents);
      const prevMonth = memberLastMonth.get(dep.memberId);
      if (!prevMonth || monthKey > prevMonth) memberLastMonth.set(dep.memberId, monthKey);
      results.push({ member: member.name, amount: depositAmountCents / 100 });
    }

    const insertedTxns = await tx.insert(transactions).values(txnInserts).returning();
    for (let i = 0; i < insertedTxns.length; i++) {
      const result = results[i];
      const inserted = insertedTxns[i];
      if (result && inserted) result.txId = inserted.id;
    }

    for (const [memberId, addedCents] of memberContributions) {
      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${addedCents / 100})::numeric(15,2)`,
          lastDepositMonth: sql`GREATEST(COALESCE(${members.lastDepositMonth}, ''), ${memberLastMonth.get(memberId) ?? ''})`,
          lastActive: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)));
    }

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric + ${totalBatchAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(and(eq(funds.id, data.fundId), eq(funds.tenantId, tenantId)));

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'BULK_DEPOSIT',
      resourceType: 'Finance',
      details: {
        batchId,
        totalAmount: totalBatchAmountCents / 100,
        count: data.deposits.length,
        fundName: fund.name,
        // `month` stays the shared month of a multi-member collection; a
        // single-member run posts into several, so every period is listed.
        month: data.commonMonth ?? null,
        months: [...batchMonths].sort(),
      },
      status: 'SUCCESS',
    });

    return { batchId, totalAmount: totalBatchAmountCents / 100, count: data.deposits.length, results };
  });
}

// ---------------------------------------------------------------------------
// 14. getMemberDepositMonths — the per-member deposit month grid (read)
// ---------------------------------------------------------------------------

/** One month cell of a member's fiscal-year deposit grid. */
export interface MemberDepositMonthCell {
  /** Absolute calendar month, YYYY-MM. */
  month: string;
  /** A settled deposit or a pending request already holds this month. */
  occupied: boolean;
  status: string | null;
  category: string | null;
  /** Money already recorded for the month (decimal(15,2) string). */
  amount: string | null;
  transactionId: string | null;
  referenceNumber: string | null;
  /** Held by a pending request — approve/reject it rather than revert. */
  pendingRequest: boolean;
}

/**
 * Which months of one fiscal year already hold a deposit for one member.
 *
 * Drives the single-member, multi-month bulk collection: the desk picks a
 * member and a financial year, and every month that is already taken comes
 * back occupied so the grid can grey it out and disable it.
 *
 * Read-only and derived from `findDepositMonthOccupancyInRange`, i.e. from the
 * SAME predicate `bulkAddDeposits` enforces — the greyed-out month is exactly
 * the month the write would reject, so the two can never drift apart.
 *
 * The month list is expanded on the SERVER from the tenant's fiscal calendar
 * (`fiscalMonthKeys`), not taken from the client: a caller cannot ask for an
 * arbitrary month window, and a July-start tenant gets its own fiscal order.
 */
export async function getMemberDepositMonths(
  query: { memberId: string; fiscalYear: string },
  user: SessionUser,
) {
  const tenantId = requireTenant(user);
  const db = getDb();

  const fiscalYear = Number(query.fiscalYear);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9998) {
    throw new AppError(
      "[Field 'fiscalYear', Code: invalid_year] Fiscal year must be a four-digit year",
      400,
      'VALIDATION_ERROR',
    );
  }

  const [member] = await db
    .select({
      id: members.id,
      name: members.name,
      memberId: members.memberId,
      status: members.status,
      shares: members.shares,
      totalContributed: members.totalContributed,
      lastDepositMonth: members.lastDepositMonth,
    })
    .from(members)
    // Fail-closed tenant scope + soft-deleted members are not readable (§6).
    .where(
      and(eq(members.id, query.memberId), eq(members.tenantId, tenantId), eq(members.isDeleted, false)),
    )
    .limit(1);
  if (!member) throw new NotFoundError('Member');

  const [settings] = await db
    .select({ fiscalYearStart: systemSettings.fiscalYearStart })
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);
  // The tenant's own fiscal calendar decides which months make up the year. A
  // malformed legacy value must not break a read, so it falls back to the
  // documented default (lib/org-setup.ts) — the same fallback the write path
  // uses when no settings row exists.
  const configuredStart = settings?.fiscalYearStart ?? null;
  const fiscalYearStart = isFiscalMonthName(configuredStart) ? configuredStart : 'July';

  const months = fiscalMonthKeys(fiscalYear, fiscalYearStart);
  const occupancy = await findDepositMonthOccupancyInRange(db, {
    tenantId,
    memberId: member.id,
    depositMonthKeys: months,
  });

  const cells: MemberDepositMonthCell[] = months.map((month) => {
    const occupant = occupancy.get(month) ?? null;
    return {
      month,
      occupied: occupant !== null,
      status: occupant?.status ?? null,
      category: occupant?.category ?? null,
      amount: occupant?.amount ?? null,
      transactionId: occupant?.id ?? null,
      referenceNumber: occupant?.referenceNumber ?? null,
      pendingRequest: String(occupant?.status ?? '').toLowerCase() === 'pending',
    };
  });

  return {
    member: {
      id: member.id,
      name: member.name,
      memberId: member.memberId,
      status: member.status,
      shares: member.shares,
      totalContributed: member.totalContributed,
      lastDepositMonth: member.lastDepositMonth,
    },
    fiscalYear: String(fiscalYear),
    fiscalYearStart,
    months: cells,
  };
}
