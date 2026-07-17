import { getDb, getSql } from '../../config/database.js';
import { transactions, funds, members, projects, projectUpdates, auditLogs, deletedRecords, systemSettings } from '../../db/schema/index.js';
import type { SQL } from 'drizzle-orm';
import { eq, and, or, desc, asc, count, ilike, inArray, gte, lte, sql } from 'drizzle-orm';
import { AppError, NotFoundError, ConflictError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import { isValidUUID } from '../../shared/utils.js';
import type { DepositInput, ExpenseInput, EarningInput, TransferInput, DividendInput, EquityTransferInput, BulkDepositInput } from './validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPOSIT_MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  'জানুয়ারি': 0, 'ফেব্রুয়ারি': 1, 'মার্চ': 2, 'এপ্রিল': 3, 'মে': 4, 'জুন': 5,
  'জুলাই': 6, 'আগস্ট': 7, 'সেপ্টেম্বর': 8, 'অক্টোবর': 9, 'নভেম্বর': 10, 'ডিসেম্বর': 11,
};

/** Convert Bengali digits (০-৯) to ASCII digits. */
function normalizeBanglaDigits(value: string = ''): string {
  return value.replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
}

/** Escape special regex characters. */
function escapeRegex(value: string = ''): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a case-insensitive regex tolerant of separators between characters.
 * "MEMBER" => "M[-_\\s]*E[-_\\s]*M[-_\\s]*B[-_\\s]*E[-_\\s]*R"
 */
function buildFlexibleMemberIdRegex(search: string): string | null {
  const compact = search.replace(/[\s\-_]+/g, '').trim();
  if (!compact) return null;
  return compact.split('').map((ch) => escapeRegex(ch)).join('[-_\\s]*');
}

/** Parse a deposit-month label (e.g. "January 2024" or "জানুয়ারি ২০২৪"). */
function parseDepositMonthLabel(depositMonth: string): Date | null {
  if (!depositMonth) return null;
  const normalized = normalizeBanglaDigits(depositMonth).trim();
  const parts = normalized.split(/\s+/);
  if (parts.length < 2) return null;
  const year = Number(parts[parts.length - 1]);
  const label = parts.slice(0, -1).join(' ').toLowerCase();
  const monthIndex = DEPOSIT_MONTH_INDEX[label];
  if (monthIndex === undefined || Number.isNaN(year) || year < 1900) return null;
  return new Date(Date.UTC(year, monthIndex, 1));
}

/**
 * Resolve the effective deposit date.
 * Prefers depositMonth label; falls back to explicit date; then first of current month.
 */
function resolveDepositDate(date?: string, depositMonth?: string): Date {
  const fromMonth = depositMonth ? parseDepositMonthLabel(depositMonth) : null;
  if (fromMonth) return fromMonth;

  if (date) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Format an amount as a decimal(15,2) string. */
function fmtAmount(n: number): string {
  return n.toFixed(2);
}

/** Number cast helper for SQL-summed values. */
function toNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// 1. getTransactions — Paginated list with totals
// ---------------------------------------------------------------------------

export async function getTransactions(query: Record<string, string | undefined>) {
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

  // --- deleted filter ----------------------------------------------------
  conditions.push(eq(transactions.isDeleted, false));

  // --- search ------------------------------------------------------------
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
      const memberConds: ReturnType<typeof or>[] = [ilike(members.memberId, `%${search}%`)];
      if (flexible) memberConds.push(sql`${members.memberId} ~* ${flexible}`);
      const matchingMembers = await db
        .select({ id: members.id })
        .from(members)
        .where(or(...memberConds));

      if (matchingMembers.length > 0) {
        conditions.push(inArray(transactions.memberId, matchingMembers.map((m) => m.id)));
      } else {
        conditions.push(sql`1=0`);
      }
    } else if (searchField === 'memberName') {
      const matchingMembers = await db
        .select({ id: members.id })
        .from(members)
        .where(ilike(members.name, `%${search}%`));

      if (matchingMembers.length > 0) {
        conditions.push(inArray(transactions.memberId, matchingMembers.map((m) => m.id)));
      } else {
        conditions.push(sql`1=0`);
      }
    } else if (searchField === 'fundName') {
      const matchingFunds = await db
        .select({ id: funds.id })
        .from(funds)
        .where(ilike(funds.name, `%${search}%`));

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
            or(
              ilike(members.name, `%${search}%`),
              ilike(members.memberId, `%${search}%`),
              ...(flexible ? [sql`${members.memberId} ~* ${flexible}`] : []),
            ),
          ),
        db
          .select({ id: funds.id })
          .from(funds)
          .where(ilike(funds.name, `%${search}%`)),
      ]);

      const orConds: ReturnType<typeof sql>[] = [
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
      if (!Number.isNaN(searchNum)) {
        orConds.push(eq(transactions.amount, String(searchNum)));
      }
      if (isValidUUID(search)) {
        orConds.push(eq(transactions.id, search));
      }

      conditions.push(or(...orConds));
    }
  }

  // --- type filter -------------------------------------------------------
  if (query.type) {
    conditions.push(eq(transactions.type, query.type));
  }

  // --- status filter -----------------------------------------------------
  if (query.status) {
    conditions.push(eq(transactions.status, query.status));
  }

  // --- month + year filter -----------------------------------------------
  if (query.month && query.year) {
    const month = parseInt(query.month, 10);
    const year = parseInt(query.year, 10);
    if (!Number.isNaN(month) && !Number.isNaN(year)) {
      const start = new Date(year, month - 1, 1);
      conditions.push(sql`${transactions.date} >= ${start.toISOString()}::timestamptz`);
      conditions.push(sql`${transactions.date} < ${new Date(year, month, 1).toISOString()}::timestamptz`);
    }
  }

  // --- sorting -----------------------------------------------------------
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
  const sortColumn = (sortFieldMap[sortBy] as any) || transactions.date;
  const orderBy = sortOrder === 'asc' ? [asc(sortColumn)] : [desc(sortColumn)];

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // --- total count -------------------------------------------------------
  const [totalResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(whereClause);
  const totalCount = Number(totalResult.count);

  // --- fetch page --------------------------------------------------------
  const rows = await db
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
      referenceNumberOut: transactions.referenceNumber,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .leftJoin(members, eq(transactions.memberId, members.id))
    .leftJoin(funds, eq(transactions.fundId, funds.id))
    .leftJoin(projects, eq(transactions.projectId, projects.id))
    .where(whereClause)
    .orderBy(...orderBy)
    .offset(skip)
    .limit(limit);

  const data = rows.map((r) => ({
    ...r,
    amount: toNum(r.amount),
    balanceBefore: r.balanceBefore ? toNum(r.balanceBefore) : null,
    balanceAfter: r.balanceAfter ? toNum(r.balanceAfter) : null,
    memberDisplayId: r.memberDisplayId || 'N/A',
    memberName: r.memberName || 'Unknown',
    fundName: r.fundName || 'N/A',
    projectName: r.projectName || '',
  }));

  // --- totals (inflow / outflow / monthly) --------------------------------
  const totalsConditions: (SQL | undefined)[] = [];
  if (conditions.length > 0) {
    // Reuse search / type / date conditions but ensure we cover successful status
    for (const c of conditions) {
      // skip the isDeleted filter if present — we add it manually below
      totalsConditions.push(c);
    }
  }
  totalsConditions.push(inArray(transactions.status, ['Completed', 'Processing']));

  // Rebuild month filter for totals as well
  // We don't push another isDeleted because condition[0] already covers it.

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalsRow] = await db
    .select({
      totalInflow: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0)`,
      totalOutflow: sql`COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend') THEN amount::numeric ELSE 0 END), 0)`,
      totalMonthly: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') AND ${transactions.date} >= ${startOfMonth.toISOString()}::timestamptz THEN amount::numeric ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(and(...totalsConditions));

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

export async function addDeposit(data: DepositInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(funds).where(eq(funds.id, data.fundId)).limit(1);
    if (!fund) throw new NotFoundError('Fund');
    const [member] = await tx.select().from(members).where(eq(members.id, data.memberId)).limit(1);
    if (!member) throw new NotFoundError('Member');

    const amount = Number(data.amount);
    const depositDate = resolveDepositDate(data.date, data.depositMonth);
    const status = data.status || 'Completed';
    const isCompleted = status === 'Completed';
    const balanceBefore = toNum(fund.balance);

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: 'Deposit',
        amount: fmtAmount(amount),
        description: data.description || '',
        memberId: data.memberId,
        fundId: data.fundId,
        date: depositDate,
        status,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName || data.cashierName || 'System',
        depositMethod: data.depositMethod || 'Cash',
        balanceBefore: fmtAmount(balanceBefore),
        balanceAfter: isCompleted ? fmtAmount(balanceBefore + amount) : fmtAmount(balanceBefore),
      })
      .returning();

    if (isCompleted) {
      await tx
        .update(funds)
        .set({ balance: fmtAmount(toNum(fund.balance) + amount), updatedAt: new Date() })
        .where(eq(funds.id, data.fundId));

      const newContributed = toNum(member.totalContributed) + amount;

      // Derive shares: shares = totalContributed / shareValueBdt
      const [settings] = await tx.select({ sv: systemSettings.shareValueBdt }).from(systemSettings).limit(1);
      const shareValue = Number(settings?.sv ?? 1000);
      const derivedShares = shareValue > 0 ? Math.floor(newContributed / shareValue) : member.shares;

      await tx
        .update(members)
        .set({
          totalContributed: fmtAmount(newContributed),
          shares: derivedShares,
          lastDepositMonth: depositDate.toISOString().slice(0, 7),
          updatedAt: new Date(),
        })
        .where(eq(members.id, data.memberId));
    }

    // Audit
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'ADD_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount, fundId: data.fundId, memberId: data.memberId, status },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: toNum(txn.amount),
      balanceBefore: txn.balanceBefore ? toNum(txn.balanceBefore) : null,
      balanceAfter: txn.balanceAfter ? toNum(txn.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. editDeposit
// ---------------------------------------------------------------------------

export async function editDeposit(id: string, data: DepositInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!existing) throw new NotFoundError('Transaction');
    if (existing.type !== 'Deposit') throw new AppError('Transaction is not a deposit', 400, 'INVALID_TYPE');

    const oldAmount = toNum(existing.amount);
    const oldFundId = existing.fundId!;
    const oldMemberId = existing.memberId!;
    const wasCompleted = existing.status === 'Completed' || existing.status === 'Success';

    const newAmount = Number(data.amount);
    const newFundId = data.fundId;
    const newMemberId = data.memberId;
    const newStatus = data.status || existing.status;
    const isNowCompleted = newStatus === 'Success' || newStatus === 'Completed';

    // 1. Revert old financial impact
    if (wasCompleted) {
      const [oldFund] = await tx.select().from(funds).where(eq(funds.id, oldFundId)).limit(1);
      if (oldFund) {
        await tx
          .update(funds)
          .set({ balance: fmtAmount(toNum(oldFund.balance) - oldAmount), updatedAt: new Date() })
          .where(eq(funds.id, oldFundId));
      }

      const [oldMember] = await tx.select().from(members).where(eq(members.id, oldMemberId)).limit(1);
      if (oldMember) {
        await tx
          .update(members)
          .set({ totalContributed: fmtAmount(toNum(oldMember.totalContributed) - oldAmount), updatedAt: new Date() })
          .where(eq(members.id, oldMemberId));
      }
    }

    // 2. Apply new financial impact
    if (isNowCompleted) {
      const [newFund] = await tx.select().from(funds).where(eq(funds.id, newFundId)).limit(1);
      if (!newFund) throw new NotFoundError(`Target fund`);

      await tx
        .update(funds)
        .set({ balance: fmtAmount(toNum(newFund.balance) + newAmount), updatedAt: new Date() })
        .where(eq(funds.id, newFundId));

      const [newMember] = await tx.select().from(members).where(eq(members.id, newMemberId)).limit(1);
      if (!newMember) throw new NotFoundError('Member');

      await tx
        .update(members)
        .set({ totalContributed: fmtAmount(toNum(newMember.totalContributed) + newAmount), updatedAt: new Date() })
        .where(eq(members.id, newMemberId));
    }

    // 3. Update transaction record
    const depositDate = resolveDepositDate(data.date, data.depositMonth || existing.description);

    const [updated] = await tx
      .update(transactions)
      .set({
        amount: fmtAmount(newAmount),
        fundId: newFundId,
        memberId: newMemberId,
        description: data.description || existing.description || '',
        date: depositDate,
        status: newStatus,
        depositMethod: data.depositMethod || existing.depositMethod,
        handlingOfficer: userName || data.cashierName || existing.handlingOfficer || 'System',
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    // 4. Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'EDIT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        previous: { amount: oldAmount, fundId: oldFundId, memberId: oldMemberId, status: existing.status },
        current: { amount: newAmount, fundId: newFundId, memberId: newMemberId, status: newStatus },
      },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: toNum(updated.amount),
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. approveDeposit
// ---------------------------------------------------------------------------

export async function approveDeposit(id: string, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [txn] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) throw new NotFoundError('Transaction');
    if (txn.status === 'Success' || txn.status === 'Completed') {
      throw new ConflictError('Transaction already approved');
    }
    if (txn.type !== 'Deposit') throw new AppError('Only deposits can be approved', 400, 'INVALID_TYPE');

    const fundId = txn.fundId!;
    const memberId = txn.memberId!;
    const [fund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
    if (!fund) throw new NotFoundError('Fund');
    const [member] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
    if (!member) throw new NotFoundError('Member');

    const txnAmount = toNum(txn.amount);

    await tx
      .update(funds)
      .set({ balance: fmtAmount(toNum(fund.balance) + txnAmount), updatedAt: new Date() })
      .where(eq(funds.id, fundId));

    await tx
      .update(members)
      .set({ totalContributed: fmtAmount(toNum(member.totalContributed) + txnAmount), updatedAt: new Date() })
      .where(eq(members.id, memberId));

    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'Completed',
        authorizedBy: userId,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'APPROVE_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: { amount: txnAmount, previousStatus: txn.status, newStatus: 'Completed' },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: toNum(updated.amount),
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. addExpense
// ---------------------------------------------------------------------------

export async function addExpense(data: ExpenseInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const fund = await tx.select().from(funds).where(eq(funds.id, data.fundId)).limit(1).then((r) => r[0]);
    if (!fund) throw new NotFoundError('Source Fund');

    const projectId = data.projectId || null;
    const amount = Number(data.amount);
    let projectRef: typeof projects.$inferSelect | null = null;
    let balanceBefore = toNum(fund.balance);

    // --- Project integrity checks ------------------------------------------
    if (projectId) {
      projectRef = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).then((r) => r[0]);
      if (!projectRef) throw new NotFoundError('Project');
      if (projectRef.linkedFundId && projectRef.linkedFundId !== data.fundId) {
        throw new AppError('Transactions for this project must be routed through its dedicated project fund.', 400, 'LINKED_FUND_MISMATCH');
      }
      balanceBefore = toNum(projectRef.currentFundBalance);
    }

    // Prevent using PROJECT-type funds for non-project expenses
    if (!projectId && fund.type === 'PROJECT') {
      throw new AppError('Project-specific funds cannot be used for general expenses. Please select a project first.', 400, 'PROJECT_FUND_RESTRICTION');
    }

    if (toNum(fund.balance) < amount) {
      throw new AppError(`Insufficient balance in ${fund.name}`, 400, 'INSUFFICIENT_BALANCE');
    }

    let description = data.description || '';

    // --- Apply Project Impact ----------------------------------------------
    if (projectId && projectRef) {
      const projBalanceBefore = toNum(projectRef.currentFundBalance);
      const newProjectBalance = projBalanceBefore - amount;

      await tx
        .update(projects)
        .set({
          currentFundBalance: fmtAmount(newProjectBalance),
          totalExpenses: fmtAmount(toNum(projectRef.totalExpenses) + amount),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      await tx.insert(projectUpdates).values({
        projectId,
        type: 'Expense',
        amount: fmtAmount(amount),
        description: description || 'Expense',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmtAmount(projBalanceBefore),
        balanceAfter: fmtAmount(newProjectBalance),
      });

      if (description && !description.includes(`[${projectRef.title}]`)) {
        description = `[${projectRef.title}] ${description}`;
      }
    }

    // --- Update Fund -------------------------------------------------------
    const newFundBalance = toNum(fund.balance) - amount;
    await tx
      .update(funds)
      .set({ balance: fmtAmount(newFundBalance), updatedAt: new Date() })
      .where(eq(funds.id, data.fundId));

    // Resolve balanceAfter for transaction record
    let balanceAfter: string;
    if (projectId) {
      const p = await tx.select({ bal: projects.currentFundBalance }).from(projects).where(eq(projects.id, projectId)).limit(1).then((r) => r[0]);
      balanceAfter = p?.bal || fmtAmount(newFundBalance);
    } else {
      balanceAfter = fmtAmount(newFundBalance);
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: 'Expense',
        amount: fmtAmount(amount),
        description,
        category: data.category || 'Operational',
        fundId: data.fundId,
        projectId,
        memberId: data.memberId || null,
        date: data.date ? new Date(data.date) : new Date(),
        status: 'Completed',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fmtAmount(balanceBefore),
        balanceAfter,
      })
      .returning();

    // --- Audit -------------------------------------------------------------
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'ADD_EXPENSE',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount, fundId: data.fundId, projectId, category: data.category },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: toNum(txn.amount),
      balanceBefore: txn.balanceBefore ? toNum(txn.balanceBefore) : null,
      balanceAfter: txn.balanceAfter ? toNum(txn.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 6. editExpense
// ---------------------------------------------------------------------------

export async function editExpense(id: string, data: ExpenseInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!existing) throw new NotFoundError('Transaction');
    if (existing.type !== 'Expense') throw new AppError('Transaction is not an expense', 400, 'INVALID_TYPE');

    const oldAmount = toNum(existing.amount);
    const oldFundId = existing.fundId!;
    const oldProjectId = existing.projectId;
    const newAmount = Number(data.amount);
    const newFundId = data.fundId;
    const newProjectId = data.projectId || null;
    let description = data.description || existing.description || '';

    // 1. Revert old impact
    if (oldProjectId) {
      const [proj] = await tx.select().from(projects).where(eq(projects.id, oldProjectId)).limit(1);
      if (proj) {
        const revertedBalance = toNum(proj.currentFundBalance) + oldAmount;
        const revertedExpenses = Math.max(0, toNum(proj.totalExpenses) - oldAmount);
        await tx
          .update(projects)
          .set({
            currentFundBalance: fmtAmount(revertedBalance),
            totalExpenses: fmtAmount(revertedExpenses),
            updatedAt: new Date(),
          })
          .where(eq(projects.id, oldProjectId));
      }
    }

    const [oldFund] = await tx.select().from(funds).where(eq(funds.id, oldFundId)).limit(1);
    if (oldFund) {
      await tx
        .update(funds)
        .set({ balance: fmtAmount(toNum(oldFund.balance) + oldAmount), updatedAt: new Date() })
        .where(eq(funds.id, oldFundId));
    }

    // 2. Apply new impact
    if (newProjectId) {
      const [proj] = await tx.select().from(projects).where(eq(projects.id, newProjectId)).limit(1);
      if (!proj) throw new NotFoundError('New project');
      if (proj.linkedFundId && proj.linkedFundId !== newFundId) {
        throw new AppError('Transactions for this project must be routed through its dedicated project fund.', 400, 'LINKED_FUND_MISMATCH');
      }

      const projBalBefore = toNum(proj.currentFundBalance);
      const newProjectBalance = projBalBefore - newAmount;

      await tx
        .update(projects)
        .set({
          currentFundBalance: fmtAmount(newProjectBalance),
          totalExpenses: fmtAmount(toNum(proj.totalExpenses) + newAmount),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, newProjectId));

      await tx.insert(projectUpdates).values({
        projectId: newProjectId,
        type: 'Expense',
        amount: fmtAmount(newAmount),
        description: description || 'Expense',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmtAmount(projBalBefore),
        balanceAfter: fmtAmount(newProjectBalance),
      });

      if (description && !description.includes(`[${proj.title}]`)) {
        description = `[${proj.title}] ${description}`;
      }
    }

    const [newFund] = await tx.select().from(funds).where(eq(funds.id, newFundId)).limit(1);
    if (!newFund) throw new NotFoundError('Source fund');

    if (!newProjectId && newFund.type === 'PROJECT') {
      throw new AppError('Project-specific funds cannot be used for general expenses.', 400, 'PROJECT_FUND_RESTRICTION');
    }

    if (toNum(newFund.balance) < newAmount) {
      throw new AppError(`Insufficient balance in ${newFund.name}`, 400, 'INSUFFICIENT_BALANCE');
    }

    await tx
      .update(funds)
      .set({ balance: fmtAmount(toNum(newFund.balance) - newAmount), updatedAt: new Date() })
      .where(eq(funds.id, newFundId));

    // 3. Update transaction record
    const [updated] = await tx
      .update(transactions)
      .set({
        amount: fmtAmount(newAmount),
        fundId: newFundId,
        projectId: newProjectId,
        memberId: data.memberId || existing.memberId,
        description,
        category: data.category || existing.category,
        date: data.date ? new Date(data.date) : existing.date,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    // 4. Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'EDIT_EXPENSE',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        previous: { amount: oldAmount, fundId: oldFundId, projectId: oldProjectId },
        current: { amount: newAmount, fundId: newFundId, projectId: newProjectId },
      },
      status: 'SUCCESS',
    });

    return {
      ...updated,
      amount: toNum(updated.amount),
      balanceBefore: updated.balanceBefore ? toNum(updated.balanceBefore) : null,
      balanceAfter: updated.balanceAfter ? toNum(updated.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 7. addEarning
// ---------------------------------------------------------------------------

export async function addEarning(data: EarningInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(funds).where(eq(funds.id, data.fundId)).limit(1);
    if (!fund) throw new NotFoundError('Target Fund');

    const amount = Number(data.amount);
    const projectId = data.projectId || null;
    let balanceBefore = toNum(fund.balance);
    let projectRef: typeof projects.$inferSelect | null = null;

    if (projectId) {
      projectRef = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).then((r) => r[0]);
      if (!projectRef) throw new NotFoundError('Project');
      if (projectRef.linkedFundId && projectRef.linkedFundId !== data.fundId) {
        throw new AppError('Transactions for this project must be routed through its dedicated project fund.', 400, 'LINKED_FUND_MISMATCH');
      }
      balanceBefore = toNum(projectRef.currentFundBalance);
    }

    // Update fund
    const newFundBalance = toNum(fund.balance) + amount;
    await tx
      .update(funds)
      .set({ balance: fmtAmount(newFundBalance), updatedAt: new Date() })
      .where(eq(funds.id, data.fundId));

    let balanceAfter = fmtAmount(newFundBalance);

    if (projectId && projectRef) {
      const projBalanceBefore = toNum(projectRef.currentFundBalance);
      const newProjectBalance = projBalanceBefore + amount;

      await tx
        .update(projects)
        .set({
          currentFundBalance: fmtAmount(newProjectBalance),
          totalEarnings: fmtAmount(toNum(projectRef.totalEarnings) + amount),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      await tx.insert(projectUpdates).values({
        projectId,
        type: 'Earning',
        amount: fmtAmount(amount),
        description: data.description || 'General Earning',
        date: data.date ? new Date(data.date) : new Date(),
        balanceBefore: fmtAmount(projBalanceBefore),
        balanceAfter: fmtAmount(newProjectBalance),
      });

      balanceAfter = fmtAmount(newProjectBalance);
    }

    const [txn] = await tx
      .insert(transactions)
      .values({
        type: 'Earning',
        amount: fmtAmount(amount),
        description: data.description || 'General Earning',
        category: data.category || 'Income',
        fundId: data.fundId,
        projectId,
        date: data.date ? new Date(data.date) : new Date(),
        status: 'Completed',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fmtAmount(balanceBefore),
        balanceAfter,
      })
      .returning();

    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'ADD_EARNING',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: { amount, fundId: data.fundId, projectId, category: data.category },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount: toNum(txn.amount),
      balanceBefore: txn.balanceBefore ? toNum(txn.balanceBefore) : null,
      balanceAfter: txn.balanceAfter ? toNum(txn.balanceAfter) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 8. deleteTransaction
// ---------------------------------------------------------------------------

export async function deleteTransaction(id: string, userId: string, userName: string, reason?: string) {
  const db = getDb();

  const deletedAmount = await db.transaction(async (tx) => {
    const [txn] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!txn) throw new NotFoundError('Transaction');

    const txnAmount = toNum(txn.amount);
    const txnFundId = txn.fundId;
    const txnProjectId = txn.projectId;
    const txnMemberId = txn.memberId;
    const deletionReason = reason || 'Manual Deletion';

    if (txn.status === 'Success' || txn.status === 'Completed') {
      // 1. Reverse fund balance
      if (txnFundId) {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, txnFundId)).limit(1);
        if (fund) {
          let adjusted = toNum(fund.balance);
          if (['Deposit', 'Earning', 'Investment'].includes(txn.type)) {
            adjusted -= txnAmount;
          } else if (['Withdrawal', 'Expense', 'Dividend'].includes(txn.type)) {
            adjusted += txnAmount;
          }
          await tx
            .update(funds)
            .set({ balance: fmtAmount(adjusted), updatedAt: new Date() })
            .where(eq(funds.id, txnFundId));
        }
      }

      // 2. Recalculate member totalContributed from remaining deposits (raw SQL subquery)
      if (txnMemberId && txn.type === 'Deposit') {
        const depositResult = (await tx.execute(
          sql`
            SELECT COALESCE(SUM(amount::numeric), 0) as total
            FROM transactions
            WHERE member_id = ${txnMemberId}
              AND type = 'Deposit'
              AND status IN ('Completed')
              AND id != ${id}
          `,
        )) as unknown as Array<{ total: string }>;
        const totalRemaining = toNum(depositResult[0]?.total || 0);
        await tx
          .update(members)
          .set({ totalContributed: fmtAmount(totalRemaining), updatedAt: new Date() })
          .where(eq(members.id, txnMemberId));
      }

      // 3. Reverse project tracking
      if (txnProjectId) {
        const [project] = await tx.select().from(projects).where(eq(projects.id, txnProjectId)).limit(1);
        if (project) {
          let balAdj = 0;
          let earnAdj = 0;
          let expAdj = 0;

          if (txn.type === 'Earning') {
            balAdj = -txnAmount;
            earnAdj = -txnAmount;
          } else if (txn.type === 'Expense') {
            balAdj = txnAmount;
            expAdj = -txnAmount;
          } else if (txn.type === 'Investment') {
            balAdj = -txnAmount;
          } else if (txn.type === 'Withdrawal') {
            balAdj = txnAmount;
          }

          await tx
            .update(projects)
            .set({
              currentFundBalance: fmtAmount(toNum(project.currentFundBalance) + balAdj),
              totalEarnings: fmtAmount(Math.max(0, toNum(project.totalEarnings) + earnAdj)),
              totalExpenses: fmtAmount(Math.max(0, toNum(project.totalExpenses) + expAdj)),
              updatedAt: new Date(),
            })
            .where(eq(projects.id, txnProjectId));
        }
      }
    }

    // 4. Archive to deletedRecords
    await tx.insert(deletedRecords).values({
      originalId: id,
      collectionName: 'Transaction',
      data: txn as unknown as Record<string, unknown>,
      reason: deletionReason,
      deletedBy: userId,
      deletedAt: new Date(),
    });

    // 5. Soft delete
    await tx
      .update(transactions)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
        deletionReason,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id));

    // 6. Audit log inside transaction
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'DELETE_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: id,
      details: { originalAmount: txnAmount, reason: deletionReason, type: txn.type },
      status: 'SUCCESS',
    });

    return txnAmount;
  });

  return { deletedAmount, message: 'Transaction deleted permanently and archived to deleted records' };
}

// ---------------------------------------------------------------------------
// 9. transferFunds
// ---------------------------------------------------------------------------

export async function transferFunds(data: TransferInput, userId: string, userName: string) {
  const db = getDb();

  if (data.sourceFundId === data.targetFundId) {
    throw new AppError('Source and target funds must be different', 400, 'SAME_FUND');
  }

  return db.transaction(async (tx) => {
    const [sourceFund] = await tx.select().from(funds).where(eq(funds.id, data.sourceFundId)).limit(1);
    const [targetFund] = await tx.select().from(funds).where(eq(funds.id, data.targetFundId)).limit(1);
    if (!sourceFund) throw new NotFoundError('Source fund');
    if (!targetFund) throw new NotFoundError('Target fund');

    const amount = Number(data.amount);
    if (toNum(sourceFund.balance) < amount) {
      throw new AppError(`Insufficient funds in ${sourceFund.name}. Gap: ${(amount - toNum(sourceFund.balance)).toFixed(2)}`, 400, 'INSUFFICIENT_BALANCE');
    }

    // Fund governance: enforce minimum balance reserve
    const sourceMinBalance = Number(sourceFund.minimumBalance ?? 0);
    const sourceAfterTransfer = toNum(sourceFund.balance) - amount;
    if (sourceAfterTransfer < sourceMinBalance) {
      throw new AppError(
        `Transfer would drop ${sourceFund.name} below its minimum reserve of ${sourceMinBalance.toFixed(2)}`,
        400, 'MINIMUM_BALANCE',
      );
    }

    const sourceBalBefore = toNum(sourceFund.balance);
    const targetBalBefore = toNum(targetFund.balance);
    const newSourceBalance = sourceBalBefore - amount;
    const newTargetBalance = targetBalBefore + amount;

    // Debit source
    await tx
      .update(funds)
      .set({ balance: fmtAmount(newSourceBalance), updatedAt: new Date() })
      .where(eq(funds.id, data.sourceFundId));

    // Credit target
    await tx
      .update(funds)
      .set({ balance: fmtAmount(newTargetBalance), updatedAt: new Date() })
      .where(eq(funds.id, data.targetFundId));

    // Withdrawal on source
    const [sourceTx] = await tx
      .insert(transactions)
      .values({
        type: 'Withdrawal',
        amount: fmtAmount(amount),
        description: `[Transfer OUT] to ${targetFund.name}: ${data.description || ''}`,
        fundId: data.sourceFundId,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fmtAmount(sourceBalBefore),
        balanceAfter: fmtAmount(newSourceBalance),
        status: 'Completed',
        date: new Date(),
      })
      .returning();

    // Investment on target
    const [targetTx] = await tx
      .insert(transactions)
      .values({
        type: 'Investment',
        amount: fmtAmount(amount),
        description: `[Transfer IN] from ${sourceFund.name}: ${data.description || ''}`,
        fundId: data.targetFundId,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fmtAmount(targetBalBefore),
        balanceAfter: fmtAmount(newTargetBalance),
        status: 'Completed',
        date: new Date(),
      })
      .returning();

    // Audit
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'FUND_TRANSFER',
      resourceType: 'Fund',
      resourceId: data.targetFundId,
      details: { amount, source: data.sourceFundId, target: data.targetFundId, sourceTxId: sourceTx.id, targetTxId: targetTx.id },
      status: 'SUCCESS',
    });

    return {
      sourceTx: {
        ...sourceTx,
        amount: toNum(sourceTx.amount),
        balanceBefore: sourceTx.balanceBefore ? toNum(sourceTx.balanceBefore) : null,
        balanceAfter: sourceTx.balanceAfter ? toNum(sourceTx.balanceAfter) : null,
      },
      targetTx: {
        ...targetTx,
        amount: toNum(targetTx.amount),
        balanceBefore: targetTx.balanceBefore ? toNum(targetTx.balanceBefore) : null,
        balanceAfter: targetTx.balanceAfter ? toNum(targetTx.balanceAfter) : null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 10. distributeDividends
// ---------------------------------------------------------------------------

interface DividendSummary {
  batchId: string;
  count: number;
  totalDisbursed: number;
  residual: number;
}

export async function distributeDividends(data: DividendInput, userId: string, userName: string): Promise<DividendSummary> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const batchId = `DIV-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const amount = Number(data.amount);

    const activeMembers = await tx
      .select()
      .from(members)
      .where(and(eq(members.status, 'active'), sql`${members.shares} > 0`));

    const totalActiveShares = activeMembers.reduce((sum, m) => sum + Number(m.shares), 0);
    if (totalActiveShares === 0) throw new AppError('No active shares available for distribution', 400, 'NO_SHARES');

    const ratePerShare = amount / totalActiveShares;

    // Calculate per-member distribution
    let totalDisbursed = 0;
    const dividendValues: Array<typeof transactions.$inferInsert> = [];

    for (const member of activeMembers) {
      const memberReward = Math.floor(Number(member.shares) * ratePerShare * 100) / 100;
      if (memberReward <= 0) continue;
      totalDisbursed += memberReward;

      dividendValues.push({
        type: 'Dividend',
        amount: fmtAmount(memberReward),
        description: data.description || `Dividend Distribution: ${data.type} Settlement [${batchId}]`,
        memberId: member.id,
        projectId: data.type === 'Project' ? (data.projectId ?? null) : null,
        fundId: data.type === 'Global' ? (data.sourceFundId ?? null) : null,
        status: 'Completed',
        referenceNumber: batchId,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
      });
    }

    if (dividendValues.length === 0) {
      throw new AppError('Calculated reward per member is too small for distribution', 400, 'SMALL_DISTRIBUTION');
    }

    // Deduct from source
    let sourceDisplayName = '';
    if (data.type === 'Project') {
      const [project] = await tx.select().from(projects).where(eq(projects.id, data.projectId!)).limit(1);
      if (!project) throw new NotFoundError('Project');
      if (toNum(project.currentFundBalance) < totalDisbursed) {
        throw new AppError(`Insufficient project balance. Required: ${totalDisbursed}, Available: ${toNum(project.currentFundBalance)}`, 400, 'INSUFFICIENT_BALANCE');
      }
      await tx
        .update(projects)
        .set({ currentFundBalance: fmtAmount(toNum(project.currentFundBalance) - totalDisbursed), updatedAt: new Date() })
        .where(eq(projects.id, data.projectId!));
      sourceDisplayName = `Project: ${project.title}`;
    } else {
      const [fund] = await tx.select().from(funds).where(eq(funds.id, data.sourceFundId!)).limit(1);
      if (!fund) throw new NotFoundError('Source Fund');
      if (toNum(fund.balance) < totalDisbursed) {
        throw new AppError(`Insufficient fund balance. Required: ${totalDisbursed}, Available: ${toNum(fund.balance)}`, 400, 'INSUFFICIENT_BALANCE');
      }
      await tx
        .update(funds)
        .set({ balance: fmtAmount(toNum(fund.balance) - totalDisbursed), updatedAt: new Date() })
        .where(eq(funds.id, data.sourceFundId!));
      sourceDisplayName = `Fund: ${fund.name}`;
    }

    // Batch insert
    await tx.insert(transactions).values(dividendValues);

    // Audit
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'DISTRIBUTE_DIVIDENDS',
      resourceType: 'Finance',
      details: {
        batchId,
        type: data.type,
        requestedAmount: amount,
        actualDisbursed: totalDisbursed,
        residual: Math.max(0, amount - totalDisbursed),
        ratePerShare,
        totalActiveShares,
        recipientsCount: dividendValues.length,
        source: sourceDisplayName,
      },
      status: 'SUCCESS',
    });

    return {
      batchId,
      count: dividendValues.length,
      totalDisbursed,
      residual: amount - totalDisbursed,
    };
  });
}

// ---------------------------------------------------------------------------
// 11. transferEquity
// ---------------------------------------------------------------------------

interface EquityTransferItem {
  toMemberId: string;
  amount?: number;
  shares: number;
}

export async function transferEquity(data: EquityTransferInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const batchId = `EQT-${Date.now()}`;
    const [sourceMember] = await tx.select().from(members).where(eq(members.id, data.fromMemberId)).limit(1);
    if (!sourceMember) throw new NotFoundError('Source member');

    const transfers: EquityTransferItem[] = data.transfers.map((t) => ({
      toMemberId: t.toMemberId,
      amount: t.amount ?? 0,
      shares: t.shares,
    }));

    const totalBeingTransferred = transfers.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalSharesTransferred = transfers.reduce((sum, t) => sum + Number(t.shares || 0), 0);

    if (totalBeingTransferred > toNum(sourceMember.totalContributed)) {
      throw new AppError(
        `Insufficient contribution balance. Transfer: ${totalBeingTransferred}, Owned: ${toNum(sourceMember.totalContributed)}`,
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

      const [targetMember] = await tx.select().from(members).where(eq(members.id, t.toMemberId)).limit(1);
      if (!targetMember) throw new NotFoundError(`Target member`);
      if (targetMember.status !== 'active') {
        throw new AppError(`Target member ${targetMember.name} is not active`, 400, 'INACTIVE_TARGET');
      }

      const targetNewContributed = toNum(targetMember.totalContributed) + Number(t.amount);
      const targetNewShares = Number(targetMember.shares) + t.shares;

      await tx
        .update(members)
        .set({
          totalContributed: fmtAmount(targetNewContributed),
          shares: targetNewShares,
          updatedAt: new Date(),
        })
        .where(eq(members.id, t.toMemberId));

      recipientValues.push({
        type: 'Equity-Transfer',
        amount: fmtAmount(Number(t.amount)),
        description: `Equity Migration: Received from ${sourceMember.name} [Reference: ${data.reason}]`,
        memberId: t.toMemberId,
        status: 'Completed',
        referenceNumber: batchId,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
      });
    }

    if (recipientValues.length > 0) {
      await tx.insert(transactions).values(recipientValues);
    }

    // Deduct from source
    const sourceNewContributed = Math.max(0, toNum(sourceMember.totalContributed) - totalBeingTransferred);
    const sourceNewShares = Math.max(0, Number(sourceMember.shares) - totalSharesTransferred);

    const updateData: Partial<typeof members.$inferInsert> & { updatedAt: Date } = {
      totalContributed: fmtAmount(sourceNewContributed),
      shares: sourceNewShares,
      updatedAt: new Date(),
    };

    // Auto-inactivate if fully drained
    if (sourceNewContributed === 0 && sourceNewShares === 0) {
      updateData.status = 'inactive';
    }

    await tx.update(members).set(updateData).where(eq(members.id, data.fromMemberId));

    // Source transaction record
    await tx.insert(transactions).values({
      type: 'Equity-Transfer',
      amount: fmtAmount(totalBeingTransferred),
      description: `Equity Migration: Transferred to ${transfers.length} recipient(s) [Reference: ${data.reason}]`,
      memberId: data.fromMemberId,
      status: 'Completed',
      referenceNumber: batchId,
      authorizedBy: userId,
      createdBy: userId,
      updatedBy: userId,
      handlingOfficer: userName,
    });

    // Audit
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'TRANSFER_EQUITY',
      resourceType: 'Member',
      resourceId: data.fromMemberId,
      details: {
        batchId,
        from: sourceMember.name,
        totalAmount: totalBeingTransferred,
        totalShares: totalSharesTransferred,
        recipients: transfers.map((t) => ({ id: t.toMemberId, amount: t.amount, shares: t.shares })),
        reason: data.reason,
      },
      status: 'SUCCESS',
    });

    return { batchId, message: 'Equity transfer completed successfully' };
  });
}

// ---------------------------------------------------------------------------
// 12. reconcileFund
// ---------------------------------------------------------------------------

export async function reconcileFund(fundId: string) {
  const db = getDb();
  const rawSql = getSql();

  const [fund] = await db.select().from(funds).where(eq(funds.id, fundId)).limit(1);
  if (!fund) throw new NotFoundError('Fund');

  const txSummary = await rawSql<{ total_in: string; total_out: string }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend', 'Adjustment') THEN amount::numeric ELSE 0 END), 0) as total_out
    FROM transactions
    WHERE fund_id = ${fund.id}
      AND status IN ('Completed')
  `;

  const stats = txSummary[0] || { total_in: '0', total_out: '0' };
  const calculatedBalance = toNum(stats.total_in) - toNum(stats.total_out);
  let isMatched = Math.abs(calculatedBalance - toNum(fund.balance)) < 0.01;
  let projectMismatch = false;

  if (fund.linkedProjectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, fund.linkedProjectId)).limit(1);
    if (project && Math.abs(toNum(fund.balance) - toNum(project.currentFundBalance)) > 0.01) {
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
    .where(eq(funds.id, fundId));

  return {
    fund: fund.name,
    actualBalance: toNum(fund.balance),
    calculatedBalance,
    isMatched,
    inflow: toNum(stats.total_in),
    outflow: toNum(stats.total_out),
    discrepancy: calculatedBalance - toNum(fund.balance),
    projectMismatch,
  };
}

// ---------------------------------------------------------------------------
// 13. bulkAddDeposits
// ---------------------------------------------------------------------------

export async function bulkAddDeposits(data: BulkDepositInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(funds).where(eq(funds.id, data.fundId)).limit(1);
    if (!fund) throw new NotFoundError('Target fund');

    const batchId = `BLK-${Date.now()}`;
    const results: Array<{ member: string; amount: number; txId: string }> = [];
    let totalBatchAmount = 0;
    const seenEntries = new Set<string>();

    for (const dep of data.deposits) {
      const month = dep.depositMonth || data.commonMonth || '';
      const entryKey = `${dep.memberId}-${month}`;

      if (seenEntries.has(entryKey)) {
        throw new AppError(`Duplicate entry detected: Member ID ${dep.memberId} is already in this batch for ${month}`, 400, 'DUPLICATE_BATCH');
      }
      seenEntries.add(entryKey);

      const [member] = await tx.select().from(members).where(eq(members.id, dep.memberId)).limit(1);
      if (!member) throw new AppError(`Member with ID ${dep.memberId} not found`, 404, 'MEMBER_NOT_FOUND');

      const depositAmount = Number(dep.amount);
      if (depositAmount <= 0) {
        throw new AppError(`Invalid amount for member ${member.name}`, 400, 'INVALID_AMOUNT');
      }

      // Duplicate prevention: check existing deposits for same member + month
      const depositDate = resolveDepositDate(dep.date, month);
      const startOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth(), 1);
      const endOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth() + 1, 0, 23, 59, 59);

      const [existingDeposit] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
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

      // Update member totalContributed (per-deposit, but we also accumulate for fund)
      const newContributed = toNum(member.totalContributed) + depositAmount;
      await tx
        .update(members)
        .set({ totalContributed: fmtAmount(newContributed), updatedAt: new Date() })
        .where(eq(members.id, dep.memberId));

      // Create deposit transaction
      const [txn] = await tx
        .insert(transactions)
        .values({
          type: 'Deposit',
          amount: fmtAmount(depositAmount),
          description: `Bulk Deposit [${month}]`,
          memberId: dep.memberId,
          fundId: data.fundId,
          date: depositDate,
          status: 'Completed',
          authorizedBy: userId,
          createdBy: userId,
          updatedBy: userId,
          handlingOfficer: userName || data.cashierName || 'System',
          depositMethod: data.depositMethod || 'Cash',
          referenceNumber: batchId,
          balanceBefore: fmtAmount(toNum(fund.balance) + totalBatchAmount),
          balanceAfter: fmtAmount(toNum(fund.balance) + totalBatchAmount + depositAmount),
        })
        .returning();

      totalBatchAmount += depositAmount;
      results.push({ member: member.name, amount: depositAmount, txId: txn.id });
    }

    // Single fund balance update for batch total
    await tx
      .update(funds)
      .set({ balance: fmtAmount(toNum(fund.balance) + totalBatchAmount), updatedAt: new Date() })
      .where(eq(funds.id, data.fundId));

    // Audit
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'BULK_DEPOSIT',
      resourceType: 'Finance',
      details: {
        batchId,
        totalAmount: totalBatchAmount,
        count: data.deposits.length,
        fundName: fund.name,
        month: data.commonMonth,
      },
      status: 'SUCCESS',
    });

    return { batchId, totalAmount: totalBatchAmount, count: data.deposits.length, results };
  });
}
