import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../../lib/db.js';
import { funds, transactions } from '../../db/schema/index.js';
import { getPaginationParams, formatPaginatedResponse, type SessionUser } from '../../middleware/api.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { parsePositiveAmount, fromCents, toCents } from '@/lib/money';

/** Fund balances, creation and inter-fund operations support. */

export interface CreateFundData {
  name: string;
  type?: 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'RESERVE' | 'OTHER';
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  currency?: string;
  handlingOfficer?: string;
  accountNumber?: string;
  initialBalance?: number | string;
  minimumBalance?: number | string;
  linkedProjectId?: string;
}

export interface UpdateFundData {
  name?: string;
  type?: 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'RESERVE' | 'OTHER';
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  currency?: string;
  handlingOfficer?: string;
  accountNumber?: string;
  minimumBalance?: number | string;
  linkedProjectId?: string;
}

export async function listFunds(
  type?: string,
  status?: string,
  query?: Record<string, string | undefined>,
  tenantId?: string | null,
) {
  const db = getDb();
  const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(query ?? {}, {
    sortBy: 'createdAt',
    sortOrder: 'desc',
    maxLimit: 200, // dropdown feeds fetch up to 200 funds
  });

  // Fail-closed tenant scope (AGENTS.md §6) — same guard as listMembers.
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }

  const conditions: (SQL | undefined)[] = [eq(funds.tenantId, tenantId)];
  if (type) conditions.push(eq(funds.type, type));
  if (status) conditions.push(eq(funds.status, status));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const SORT_MAP: Record<string, unknown> = {
    name: funds.name,
    type: funds.type,
    status: funds.status,
    balance: funds.balance,
    createdAt: funds.createdAt,
    updatedAt: funds.updatedAt,
  };
  const sortCol = (SORT_MAP[sortBy] as typeof funds.createdAt) ?? funds.createdAt;
  const orderFn = sortOrder === 'asc' ? asc : desc;

  // Single query: data + total count via window function
  const rows = await db
    .select({ fund: funds, totalCount: sql<number>`COUNT(*) OVER()` })
    .from(funds)
    .where(whereClause)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(skip);

  const totalCount = rows.length > 0 ? Number(rows[0]?.totalCount ?? 0) : 0;
  const data = rows.map((r) => r.fund);

  return formatPaginatedResponse(data, page, limit, totalCount);
}

export async function getFundById(id: string, tenantId?: string | null) {
  const db = getDb();
  const conditions = [eq(funds.id, id)];
  if (tenantId) conditions.push(eq(funds.tenantId, tenantId));

  const [fund] = await db
    .select()
    .from(funds)
    .where(and(...conditions))
    .limit(1);
  if (!fund) throw new NotFoundError('Fund');
  return fund;
}

export async function createFund(data: CreateFundData, user: SessionUser, tenantId?: string | null) {
  const effectiveTenantId = tenantId || user.tenantId;
  if (!effectiveTenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }

  const db = getDb();

  if (data.type === 'PROJECT') {
    throw new AppError(
      'PROJECT funds are automatically created when a Project is initialized.',
      400,
      'PROJECT_FUND_NOT_ALLOWED',
    );
  }

  const minBalCents = data.minimumBalance ? parsePositiveAmount(data.minimumBalance) : 0;

  return db.transaction(async (tx) => {
    const [fund] = await tx
      .insert(funds)
      .values({
        tenantId: effectiveTenantId,
        name: data.name,
        type: data.type || 'OTHER',
        status: data.status || 'ACTIVE',
        balance: '0',
        minimumBalance: fromCents(minBalCents),
        currency: data.currency || 'BDT',
        description: data.description ?? null,
        handlingOfficer: data.handlingOfficer ?? null,
        accountNumber: data.accountNumber ?? null,
        linkedProjectId: data.linkedProjectId ?? null,
      })
      .returning();

    if (!fund) throw new AppError('Failed to create fund', 500);

    if (data.initialBalance) {
      const initialCents = parsePositiveAmount(data.initialBalance);
      if (initialCents > 0) {
        await tx.insert(transactions).values({
          tenantId: effectiveTenantId,
          type: 'Deposit',
          amount: fromCents(initialCents),
          description: `Opening Balance for ${data.name}`,
          fundId: fund.id,
          date: new Date(),
          authorizedBy: user.id,
          createdBy: user.id,
          handlingOfficer: user.name,
          status: 'Completed',
          balanceBefore: '0.00',
          balanceAfter: fromCents(initialCents),
        });
        await tx.update(funds).set({ balance: fromCents(initialCents) }).where(eq(funds.id, fund.id));
      }
    }

    return fund;
  });
}

export async function updateFund(id: string, data: UpdateFundData, tenantId?: string | null) {
  const db = getDb();
  const conditions = [eq(funds.id, id)];
  if (tenantId) conditions.push(eq(funds.tenantId, tenantId));

  const [existing] = await db
    .select()
    .from(funds)
    .where(and(...conditions))
    .limit(1);
  if (!existing) throw new NotFoundError('Fund');

  if (data.type === 'PROJECT' && existing.type !== 'PROJECT') {
    throw new AppError('Cannot manually change a fund to PROJECT type', 400, 'PROJECT_FUND_NOT_ALLOWED');
  }

  // A dividend run needs one reachable active RESERVE fund, so refuse to strand
  // a tenant with none by re-typing, closing or inactivating its only one.
  // Type is compared case-insensitively because pre-normalization rows can hold
  // 'Reserve', which the dividend lookup used to miss entirely.
  const isReserve = (existing.type ?? '').toUpperCase() === 'RESERVE';
  const leavesReservePool =
    isReserve &&
    ((data.type !== undefined && data.type !== 'RESERVE') ||
      (data.status !== undefined && data.status !== 'ACTIVE'));
  if (leavesReservePool && tenantId) {
    const [replacement] = await db
      .select({ id: funds.id })
      .from(funds)
      .where(
        and(
          eq(funds.tenantId, tenantId),
          sql`upper(${funds.type}) = 'RESERVE'`,
          eq(funds.status, 'ACTIVE'),
          sql`${funds.id} <> ${id}`,
        ),
      )
      .limit(1);
    if (!replacement) {
      throw new AppError(
        `"${existing.name}" is the only active RESERVE fund. Dividend distribution retains its statutory reserve here, so create another active RESERVE fund before changing this one.`,
        400,
        'LAST_RESERVE_FUND',
      );
    }
  }

  // Financial invariant: cannot close a fund with active balance
  if (data.status === 'CLOSED' && existing.status !== 'CLOSED') {
    const curBalanceCents = toCents(existing.balance ?? '0');
    if (curBalanceCents > 0) {
      throw new AppError(
        `Cannot close fund "${existing.name}" with remaining balance of ${fromCents(curBalanceCents)}. Transfer or disburse all funds before closing.`,
        400,
        'FUND_HAS_BALANCE',
      );
    }
  }

  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateFields.name = data.name;
  if (data.type !== undefined) updateFields.type = data.type;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.currency !== undefined) updateFields.currency = data.currency;
  if (data.handlingOfficer !== undefined) updateFields.handlingOfficer = data.handlingOfficer;
  if (data.accountNumber !== undefined) updateFields.accountNumber = data.accountNumber;
  if (data.linkedProjectId !== undefined) updateFields.linkedProjectId = data.linkedProjectId;
  if (data.minimumBalance !== undefined) {
    const minCents = data.minimumBalance ? parsePositiveAmount(data.minimumBalance) : 0;
    updateFields.minimumBalance = fromCents(minCents);
  }

  if (Object.keys(updateFields).length === 1) return existing;

  const [updated] = await db
    .update(funds)
    .set(updateFields)
    .where(and(...conditions))
    .returning();
  return updated;
}

export async function deleteFund(id: string, tenantId?: string | null) {
  const db = getDb();
  const conditions = [eq(funds.id, id)];
  if (tenantId) conditions.push(eq(funds.tenantId, tenantId));

  const [existing] = await db
    .select()
    .from(funds)
    .where(and(...conditions))
    .limit(1);
  if (!existing) throw new NotFoundError('Fund');

  const curBalanceCents = toCents(existing.balance ?? '0');
  if (curBalanceCents > 0) {
    throw new AppError(
      `Cannot remove fund with remaining balance of ${fromCents(curBalanceCents)}. Transfer all funds before closing.`,
      400,
      'FUND_HAS_BALANCE',
    );
  }

  const [updated] = await db
    .update(funds)
    .set({ status: 'CLOSED', updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return updated;
}
