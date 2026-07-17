import { getDb } from '../../config/database.js';
import { funds, transactions } from '../../db/schema/index.js';
import { eq, and, desc, asc, count, sql, type SQL } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import type { PaginatedResponse } from '../../shared/types.js';
import { cache } from '../../lib/cache.js';

const FUNDS_CACHE_KEY = 'funds:list';
const FUNDS_CACHE_TTL = 30_000; // 30 seconds

export interface CreateFundData {
  name: string;
  type?: 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'OTHER';
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  balance?: number;
  currency?: string;
  handlingOfficer?: string;
  accountNumber?: string;
  initialBalance?: number;
  linkedProjectId?: string;
}

export interface UpdateFundData {
  name?: string;
  type?: 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'OTHER';
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  balance?: number;
  currency?: string;
  handlingOfficer?: string;
  accountNumber?: string;
  initialBalance?: number;
  linkedProjectId?: string;
}

export async function listFunds(
  type?: string,
  status?: string,
  query?: Record<string, string | undefined>,
): Promise<PaginatedResponse<typeof funds.$inferSelect>> {
  const cacheKey = `${FUNDS_CACHE_KEY}:${type ?? ''}:${status ?? ''}:${JSON.stringify(query ?? {})}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      const db = getDb();
      const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(query ?? {}, {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      const conditions: (SQL | undefined)[] = [];
      if (type) conditions.push(eq(funds.type, type));
      if (status) conditions.push(eq(funds.status, status));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Sorting — whitelist safe columns
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

      // Single query: data + total count via window function (saves one DB round-trip)
      const rows = await db
        .select({
          fund: funds,
          totalCount: sql<number>`COUNT(*) OVER()`,
        })
        .from(funds)
        .where(whereClause)
        .orderBy(orderFn(sortCol))
        .limit(limit)
        .offset(skip);

      const totalCount = rows.length > 0 ? Number(rows[0].totalCount) : 0;
      const data = rows.map((r) => r.fund);

      return formatPaginatedResponse(data, page, limit, totalCount);
    },
    FUNDS_CACHE_TTL,
  );
}

export async function getFundById(id: string) {
  const db = getDb();

  const [fund] = await db
    .select()
    .from(funds)
    .where(eq(funds.id, id))
    .limit(1);

  if (!fund) {
    throw new NotFoundError('Fund');
  }

  return fund;
}

export async function createFund(data: CreateFundData) {
  const db = getDb();

  if (data.type === 'PROJECT') {
    throw new AppError(
      'PROJECT funds are automatically created when a Project is initialized.',
      400,
      'PROJECT_FUND_NOT_ALLOWED',
    );
  }

  const result = await db.transaction(async (tx) => {
    const [fund] = await tx
      .insert(funds)
      .values({
        name: data.name,
        type: data.type || 'OTHER',
        status: data.status || 'ACTIVE',
        balance: '0',
        currency: data.currency || 'BDT',
        description: data.description ?? null,
        handlingOfficer: data.handlingOfficer ?? null,
        accountNumber: data.accountNumber ?? null,
        linkedProjectId: data.linkedProjectId ?? null,
      })
      .returning();

    if (data.initialBalance && data.initialBalance > 0) {
      await tx.insert(transactions).values({
        type: 'Deposit',
        amount: String(data.initialBalance),
        description: `Opening Balance for ${data.name}`,
        fundId: fund.id,
        date: new Date(),
      });

      await tx
        .update(funds)
        .set({ balance: String(data.initialBalance) })
        .where(eq(funds.id, fund.id));
    }

    return fund;
  });

  cache.delByPrefix(FUNDS_CACHE_KEY);
  return result;
}

export async function updateFund(id: string, data: UpdateFundData) {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(funds)
    .where(eq(funds.id, id))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('Fund');
  }

  const updateFields: Record<string, unknown> = {};

  if (data.name !== undefined) updateFields.name = data.name;
  if (data.type !== undefined) updateFields.type = data.type;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.currency !== undefined) updateFields.currency = data.currency;
  if (data.handlingOfficer !== undefined) updateFields.handlingOfficer = data.handlingOfficer;
  if (data.accountNumber !== undefined) updateFields.accountNumber = data.accountNumber;
  if (data.linkedProjectId !== undefined) updateFields.linkedProjectId = data.linkedProjectId;

  if (Object.keys(updateFields).length === 0) {
    return existing;
  }

  const [updated] = await db
    .update(funds)
    .set(updateFields)
    .where(eq(funds.id, id))
    .returning();

  cache.delByPrefix(FUNDS_CACHE_KEY);
  return updated;
}

export async function deleteFund(id: string) {
  const db = getDb();

  const [fund] = await db
    .select()
    .from(funds)
    .where(eq(funds.id, id))
    .limit(1);

  if (!fund) {
    throw new NotFoundError('Fund');
  }

  if (Number(fund.balance) > 0) {
    throw new AppError(
      'Cannot delete fund with non-zero balance. Transfer funds first.',
      400,
      'FUND_BALANCE_NOT_ZERO',
    );
  }

  const [txCountResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.fundId, id));

  const transactionCount = Number(txCountResult?.count || 0);
  if (transactionCount > 0) {
    throw new AppError(
      `Cannot delete fund. It has ${transactionCount} linked transactions. Archive them first.`,
      400,
      'FUND_HAS_TRANSACTIONS',
    );
  }

  await db.delete(funds).where(eq(funds.id, id));
  cache.delByPrefix(FUNDS_CACHE_KEY);
}
