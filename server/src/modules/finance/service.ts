import { eq, and, or, desc, asc, count, ilike, inArray, gte, lte, sql, aliasedTable } from 'drizzle-orm';
import { getDb, getSql } from '../../lib/db.js';
import {
  transactions,
  funds,
  members,
  projects,
  projectUpdates,
  auditLogs,
  deletedRecords,
  users,
} from '../../db/schema/index.js';
import type { SQL } from 'drizzle-orm';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse, requireTenant, type SessionUser } from '../../middleware/api.js';
import {
  parsePositiveAmount,
  splitDividendByShares,
  fromCents,
  toCents,
  parseDepositMonthToIso,
} from '@/lib/money';
import { assertIntegralShares } from '@/lib/shares';

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

/** Resolve the effective deposit date (money received) from date/month label. */
function resolveDepositDate(date?: string | null, depositMonth?: string | null): Date {
  if (date) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const iso = parseDepositMonthToIso(depositMonth);
  if (iso) return new Date(`${iso}T00:00:00.000Z`);
  return new Date();
}

interface DepositInput {
  memberId: string;
  amount: number | string;
  fundId: string;
  description?: string | null;
  date?: string | null;
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
}

interface DividendInput {
  type: 'Global' | 'Project';
  amount: number | string;
  projectId?: string | null;
  sourceFundId?: string | null;
  description?: string | null;
}

interface EquityTransferInput {
  fromMemberId: string;
  transfers: Array<{ toMemberId: string; amount?: number; shares: number }>;
  reason: string;
}

interface BulkDepositInput {
  fundId: string;
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

export type { DepositInput, ExpenseInput, EarningInput, TransferInput, DividendInput, EquityTransferInput, BulkDepositInput };

// ---------------------------------------------------------------------------
// 1. getTransactions — Paginated ledger with totals
// ---------------------------------------------------------------------------

export async function getTransactions(query: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const { page, limit, skip, sortBy: sortByParam } = getPaginationParams(query, {
    sortBy: 'date',
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

  if (query.startDate) {
    conditions.push(sql`${transactions.date} >= ${new Date(query.startDate).toISOString()}::timestamptz`);
  }
  if (query.endDate) {
    const end = new Date(query.endDate);
    end.setHours(23, 59, 59, 999);
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
        memberName: members.name,
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
    const [member] = await tx.select().from(members).where(and(eq(members.id, targetMemberId), eq(members.tenantId, tenantId))).for('update').limit(1);
    if (!member) throw new NotFoundError('Member');

    // amount > 0 enforced in cents (§12)
    const amountCents = parsePositiveAmount(data.amount);

    const status = data.status || 'Completed';
    const isCompleted = status === 'Completed';
    const balanceBeforeCents = toCents(fund.balance ?? '0');

    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Deposit',
        amount: fmt(amountCents),
        description: data.description || '',
        memberId: targetMemberId,
        fundId: data.fundId,
        date: resolveDepositDate(data.date, data.depositMonth),
        status,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name || data.cashierName || 'System',
        depositMethod: data.depositMethod || 'Cash',
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

      const billingPeriodIso =
        parseDepositMonthToIso(data.depositMonth || data.description || '') ||
        (txn.date ? new Date(txn.date).toISOString().slice(0, 10) : null);
      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${amountCents / 100})::numeric(15,2)`,
          lastDepositMonth: billingPeriodIso ? billingPeriodIso.slice(0, 7) : null,
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
        throw new ForbiddenError('You cannot reassign a deposit request to another member');
      }
    }

    const oldAmountCents = toCents(existing.amount);
    const oldFundId = existing.fundId!;
    const oldMemberId = existing.memberId!;
    const wasCompleted = existing.status === 'Completed' || existing.status === 'Success';

    const newAmountCents = parsePositiveAmount(data.amount);
    const newFundId = data.fundId;
    const newMemberId = data.memberId;
    const newStatus = data.status || existing.status || 'Completed';
    const isNowCompleted = newStatus === 'Success' || newStatus === 'Completed';

    // 1. Revert old financial impact
    if (wasCompleted) {
      const [oldFund] = await tx.select().from(funds).where(and(eq(funds.id, oldFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
      if (oldFund) {
        await tx
          .update(funds)
          .set({ balance: sql`(${funds.balance}::numeric - ${oldAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
          .where(eq(funds.id, oldFundId));
      }
      const [oldMember] = await tx.select().from(members).where(and(eq(members.id, oldMemberId), eq(members.tenantId, tenantId))).for('update').limit(1);
      if (oldMember) {
        await tx
          .update(members)
          .set({
            totalContributed: sql`GREATEST(0, (${members.totalContributed}::numeric - ${oldAmountCents / 100}))::numeric(15,2)`,
            updatedAt: new Date(),
          })
          .where(eq(members.id, oldMemberId));
      }
    }

    // 2. Apply new financial impact
    if (isNowCompleted) {
      const [newFund] = await tx.select().from(funds).where(and(eq(funds.id, newFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
      if (!newFund) throw new NotFoundError('Target fund');
      await tx
        .update(funds)
        .set({ balance: sql`(${funds.balance}::numeric + ${newAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
        .where(eq(funds.id, newFundId));

      const [newMember] = await tx.select().from(members).where(and(eq(members.id, newMemberId), eq(members.tenantId, tenantId))).for('update').limit(1);
      if (!newMember) throw new NotFoundError('Member');
      await tx
        .update(members)
        .set({ totalContributed: sql`(${members.totalContributed}::numeric + ${newAmountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
        .where(eq(members.id, newMemberId));
    }

    // 3. Update transaction record
    const depositDate = resolveDepositDate(data.date, data.depositMonth || existing.description);

    const [updated] = await tx
      .update(transactions)
      .set({
        amount: fmt(newAmountCents),
        fundId: newFundId,
        memberId: newMemberId,
        description: data.description || existing.description || '',
        date: depositDate,
        status: newStatus,
        depositMethod: data.depositMethod || existing.depositMethod,
        handlingOfficer: user.name || data.cashierName || existing.handlingOfficer || 'System',
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Transaction');

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'EDIT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        previous: { amount: oldAmountCents / 100, fundId: oldFundId, memberId: oldMemberId, status: existing.status },
        current: { amount: newAmountCents / 100, fundId: newFundId, memberId: newMemberId, status: newStatus },
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
      throw new AppError('Project-specific funds cannot be used for general expenses.', 400, 'PROJECT_FUND_RESTRICTION');
    }

    if (toCents(newFund.balance ?? '0') < newAmountCents) {
      throw new AppError(`Insufficient balance in ${newFund.name}`, 400, 'INSUFFICIENT_BALANCE');
    }

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
        date: data.date ? new Date(data.date) : existing.date,
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
        previous: { amount: oldAmountCents / 100, fundId: oldFundId, projectId: oldProjectId },
        current: { amount: newAmountCents / 100, fundId: newFundId, projectId: newProjectId },
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
    const [txn] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId))).limit(1);
    if (!txn) throw new NotFoundError('Transaction');

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
      // 1. Reverse fund balance
      if (txnFundId) {
        const [fund] = await tx.select().from(funds).where(and(eq(funds.id, txnFundId), eq(funds.tenantId, tenantId))).limit(1);
        if (fund) {
          let adjustedCents = toCents(fund.balance ?? '0');
          if (['Deposit', 'Earning', 'Investment'].includes(txn.type)) {
            adjustedCents -= txnCents;
            const minReserveCents = toCents(fund.minimumBalance ?? '0');
            if (adjustedCents < minReserveCents) {
              throw new AppError(
                `Cannot delete transaction: reversing ${(txnCents / 100).toFixed(2)} would drop ${fund.name} balance below minimum reserve (${fund.balance} -> ${fromCents(Math.max(0, adjustedCents))})`,
                400,
                'FUND_DEFICIT_PREVENTED',
              );
            }
          } else if (['Withdrawal', 'Expense', 'Dividend'].includes(txn.type)) {
            adjustedCents += txnCents;
          }
          await tx
            .update(funds)
            .set({ balance: fmt(adjustedCents), updatedAt: new Date() })
            .where(eq(funds.id, txnFundId));
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
                AND status IN ('Completed')
                AND is_deleted = false
                AND id != ${id}`,
        )) as unknown as Array<{ total: string }>;
        const totalRemaining = toNum(result[0]?.total || 0);
        await tx
          .update(members)
          .set({ totalContributed: fromCents(Math.round(totalRemaining * 100)), updatedAt: new Date() })
          .where(eq(members.id, txnMemberId));
      }

      // 3. Reverse project tracking
      if (txnProjectId) {
        const [project] = await tx.select().from(projects).where(and(eq(projects.id, txnProjectId), eq(projects.tenantId, tenantId))).limit(1);
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
            .where(eq(projects.id, txnProjectId));
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
      .where(eq(transactions.id, id));

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
    const [sourceFund] = await tx.select().from(funds).where(and(eq(funds.id, data.sourceFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    const [targetFund] = await tx.select().from(funds).where(and(eq(funds.id, data.targetFundId), eq(funds.tenantId, tenantId))).for('update').limit(1);
    if (!sourceFund) throw new NotFoundError('Source fund');
    if (!targetFund) throw new NotFoundError('Target fund');

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

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric - ${amountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, data.sourceFundId));

    await tx
      .update(funds)
      .set({ balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`, updatedAt: new Date() })
      .where(eq(funds.id, data.targetFundId));

    const [sourceTx] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Withdrawal',
        amount: fmt(amountCents),
        description: `[Transfer OUT] to ${targetFund.name}: ${data.description || ''}`,
        fundId: data.sourceFundId,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(sourceBalBeforeCents),
        balanceAfter: fmt(newSourceBalanceCents),
        status: 'Completed',
        date: new Date(),
      })
      .returning();

    const [targetTx] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Investment',
        amount: fmt(amountCents),
        description: `[Transfer IN] from ${sourceFund.name}: ${data.description || ''}`,
        fundId: data.targetFundId,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
        balanceBefore: fmt(targetBalBeforeCents),
        balanceAfter: fmt(newTargetBalanceCents),
        status: 'Completed',
        date: new Date(),
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
// 10. distributeDividends — exact shares-weighted split, idempotent batch
// ---------------------------------------------------------------------------

export interface DividendSummary {
  batchId: string;
  count: number;
  totalDisbursed: number;
  residual: number;
}

export async function distributeDividends(data: DividendInput, user: SessionUser): Promise<DividendSummary> {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const batchId = `DIV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const amountCents = parsePositiveAmount(data.amount, { maxCents: 100_000_000 * 100 });

    const activeMembers = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.status, 'active'), sql`${members.shares} > 0`));

    // Exact largest-remainder split in cents — sum(payouts) === disbursement
    // never exceeds amountCents (verified in lib/money.test.ts).
    const payouts = splitDividendByShares(
      amountCents,
      activeMembers.map((m) => ({ id: m.id, shares: Number(m.shares) })),
    );

    const dividendValues: Array<typeof transactions.$inferInsert> = payouts
      .filter((p) => p.payoutCents > 0)
      .map((p) => ({
        tenantId,
        type: 'Dividend',
        amount: fmt(p.payoutCents),
        description:
          data.description || `Dividend Distribution: ${data.type} Settlement [${batchId}]`,
        memberId: p.id,
        projectId: data.type === 'Project' ? (data.projectId ?? null) : null,
        fundId: data.type === 'Global' ? (data.sourceFundId ?? null) : null,
        status: 'Completed',
        referenceNumber: batchId,
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name,
      }));

    if (dividendValues.length === 0) {
      throw new AppError('Calculated reward per member is too small for distribution', 400, 'SMALL_DISTRIBUTION');
    }

    const totalDisbursedCents = dividendValues.reduce((sum, v) => sum + toCents(String(v.amount)), 0);

    // Deduct from source
    let sourceDisplayName = '';
    if (data.type === 'Project') {
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, data.projectId!), eq(projects.tenantId, tenantId))).limit(1);
      if (!project) throw new NotFoundError('Project');
      if (toCents(project.currentFundBalance ?? '0') < totalDisbursedCents) {
        throw new AppError(
          `Insufficient project balance. Required: ${fromCents(totalDisbursedCents)}, Available: ${project.currentFundBalance}`,
          400,
          'INSUFFICIENT_BALANCE',
        );
      }
      await tx
        .update(projects)
        .set({ currentFundBalance: fmt(toCents(project.currentFundBalance ?? '0') - totalDisbursedCents), updatedAt: new Date() })
        .where(eq(projects.id, data.projectId!));
      sourceDisplayName = `Project: ${project.title}`;
    } else {
      const [fund] = await tx.select().from(funds).where(and(eq(funds.id, data.sourceFundId!), eq(funds.tenantId, tenantId))).limit(1);
      if (!fund) throw new NotFoundError('Source Fund');
      if (toCents(fund.balance ?? '0') < totalDisbursedCents) {
        throw new AppError(
          `Insufficient fund balance. Required: ${fromCents(totalDisbursedCents)}, Available: ${fund.balance}`,
          400,
          'INSUFFICIENT_BALANCE',
        );
      }
      await tx
        .update(funds)
        .set({ balance: fmt(toCents(fund.balance ?? '0') - totalDisbursedCents), updatedAt: new Date() })
        .where(eq(funds.id, data.sourceFundId!));
      sourceDisplayName = `Fund: ${fund.name}`;
    }

    await tx.insert(transactions).values(dividendValues);

    await tx.insert(auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'DISTRIBUTE_DIVIDENDS',
      resourceType: 'Finance',
      details: {
        batchId,
        type: data.type,
        requestedAmount: amountCents / 100,
        actualDisbursed: totalDisbursedCents / 100,
        residual: (amountCents - totalDisbursedCents) / 100,
        totalActiveShares: activeMembers.reduce((sum, m) => sum + Number(m.shares), 0),
        recipientsCount: dividendValues.length,
        source: sourceDisplayName,
      },
      status: 'SUCCESS',
    });

    return {
      batchId,
      count: dividendValues.length,
      totalDisbursed: totalDisbursedCents / 100,
      residual: (amountCents - totalDisbursedCents) / 100,
    };
  });
}

// ---------------------------------------------------------------------------
// 11. transferEquity
// ---------------------------------------------------------------------------

export async function transferEquity(data: EquityTransferInput, user: SessionUser) {
  const tenantId = requireTenant(user);
  const db = getDb();

  return db.transaction(async (tx) => {
    const batchId = `EQT-${Date.now()}`;
    const [sourceMember] = await tx.select().from(members).where(and(eq(members.id, data.fromMemberId), eq(members.tenantId, tenantId))).limit(1);
    if (!sourceMember) throw new NotFoundError('Source member');

    const transfers = data.transfers.map((t) => ({
      toMemberId: t.toMemberId,
      amountCents: t.amount ? parsePositiveAmount(t.amount) : 0,
      shares: assertIntegralShares(t.shares, 'transfers.shares'),
    }));

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

    const recipientValues: Array<typeof transactions.$inferInsert> = [];

    for (const t of transfers) {
      if (t.toMemberId === data.fromMemberId) {
        throw new AppError('Self-transfer of equity is not permitted', 400, 'SELF_TRANSFER');
      }

      const [targetMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, t.toMemberId), eq(members.tenantId, tenantId)))
        .limit(1);
      if (!targetMember) throw new NotFoundError('Target member');
      if (targetMember.status !== 'active') {
        throw new AppError(`Target member ${targetMember.name} is not active`, 400, 'INACTIVE_TARGET');
      }

      const targetNewContributedCents = toCents(targetMember.totalContributed ?? '0') + t.amountCents;
      const targetNewShares = Number(targetMember.shares) + t.shares;

      await tx
        .update(members)
        .set({ totalContributed: fmt(targetNewContributedCents), shares: targetNewShares, updatedAt: new Date() })
        .where(and(eq(members.id, t.toMemberId), eq(members.tenantId, tenantId)));

      recipientValues.push({
        type: 'Equity-Transfer',
        amount: fmt(t.amountCents),
        description: `Equity Migration: Received from ${sourceMember.name} [Reference: ${data.reason}]`,
        memberId: t.toMemberId,
        status: 'Completed',
        referenceNumber: batchId,
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
      updatedAt: new Date(),
    };

    if (sourceNewContributedCents === 0 && sourceNewShares === 0) {
      updateData.status = 'inactive';
    }

    await tx.update(members).set(updateData).where(and(eq(members.id, data.fromMemberId), eq(members.tenantId, tenantId)));

    await tx.insert(transactions).values({
      type: 'Equity-Transfer',
      amount: fmt(totalBeingTransferredCents),
      description: `Equity Migration: Transferred to ${transfers.length} recipient(s) [Reference: ${data.reason}]`,
      memberId: data.fromMemberId,
      status: 'Completed',
      referenceNumber: batchId,
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
        totalAmount: totalBeingTransferredCents / 100,
        totalShares: totalSharesTransferred,
        recipients: transfers.map((t) => ({ id: t.toMemberId, amount: t.amountCents / 100, shares: t.shares })),
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

  const txSummary = await rawSql<{ total_in: string; total_out: string }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend', 'Adjustment') THEN amount::numeric ELSE 0 END), 0) as total_out
    FROM transactions
    WHERE fund_id = ${fund.id}
      AND tenant_id = ${tenantId}
      AND status IN ('Completed')
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
// 13. bulkAddDeposits — idempotent batch (unique batchId reference)
// ---------------------------------------------------------------------------

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

    const batchId = `BLK-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const seenEntries = new Set<string>();
    const memberIds = data.deposits.map((d) => d.memberId);

    for (const dep of data.deposits) {
      const month = dep.depositMonth || data.commonMonth || '';
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

    let totalBatchAmountCents = 0;
    const runningFundBalanceCents = toCents(fund.balance ?? '0');
    const txnInserts: Array<typeof transactions.$inferInsert> = [];
    const memberContributions = new Map<string, number>();
    const results: Array<{ member: string; amount: number; txId?: string }> = [];

    for (const dep of data.deposits) {
      const member = memberMap.get(dep.memberId);
      if (!member) throw new AppError(`Member with ID ${dep.memberId} not found`, 404, 'MEMBER_NOT_FOUND');

      const depositAmountCents = parsePositiveAmount(dep.amount);
      const month = dep.depositMonth || data.commonMonth || '';
      const depositDate = resolveDepositDate(dep.date, month);

      // Duplicate deposit check for this month
      const startOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth(), 1);
      const endOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth() + 1, 0, 23, 59, 59);

      const [existingDeposit] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, tenantId),
            eq(transactions.type, 'Deposit'),
            eq(transactions.memberId, dep.memberId),
            eq(transactions.fundId, data.fundId),
            gte(transactions.date, startOfMonth),
            lte(transactions.date, endOfMonth),
            inArray(transactions.status, ['Completed']),
          ),
        )
        .limit(1);

      if (existingDeposit) {
        throw new AppError(
          `Duplicate deposit detected: Member ${member.name} already has a deposit in ${month} (Transaction ID: ${existingDeposit.id})`,
          409,
          'DUPLICATE_DEPOSIT',
        );
      }

      const balanceBeforeCents = runningFundBalanceCents + totalBatchAmountCents;
      const balanceAfterCents = balanceBeforeCents + depositAmountCents;
      totalBatchAmountCents += depositAmountCents;

      txnInserts.push({
        type: 'Deposit',
        amount: fmt(depositAmountCents),
        description: `Bulk Deposit [${month}]`,
        memberId: dep.memberId,
        fundId: data.fundId,
        date: depositDate,
        status: 'Completed',
        authorizedBy: user.id,
        createdBy: user.id,
        updatedBy: user.id,
        handlingOfficer: user.name || data.cashierName || 'System',
        depositMethod: data.depositMethod || 'Cash',
        referenceNumber: batchId,
        balanceBefore: fmt(balanceBeforeCents),
        balanceAfter: fmt(balanceAfterCents),
      });

      memberContributions.set(dep.memberId, (memberContributions.get(dep.memberId) || 0) + depositAmountCents);
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
        .set({ totalContributed: sql`(${members.totalContributed}::numeric + ${addedCents / 100})::numeric(15,2)`, updatedAt: new Date() })
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
        month: data.commonMonth,
      },
      status: 'SUCCESS',
    });

    return { batchId, totalAmount: totalBatchAmountCents / 100, count: data.deposits.length, results };
  });
}
