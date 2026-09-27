import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../../lib/db.js';
import { funds, transactions } from '../../db/schema/index.js';
import { getPaginationParams, formatPaginatedResponse, type SessionUser } from '../../middleware/api.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { parsePositiveAmount, fromCents } from '@/lib/money';

/** Fund balances, creation and inter-fund operations support. */

export interface CreateFundData {
  name: string;
  type?: 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'OTHER';
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
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
  currency?: string;
  handlingOfficer?: string;
  accountNumber?: string;
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

export async function getFundById(id: string) {
  const db = getDb();
  const [fund] = await db.select().from(funds).where(eq(funds.id, id)).limit(1);
  if (!fund) throw new NotFoundError('Fund');
  return fund;
}

export async function createFund(data: CreateFundData, user: SessionUser) {
  const db = getDb();

  if (data.type === 'PROJECT') {
    throw new AppError(
      'PROJECT funds are automatically created when a Project is initialized.',
      400,
      'PROJECT_FUND_NOT_ALLOWED',
    );
  }

  return db.transaction(async (tx) => {
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

    if (!fund) throw new AppError('Failed to create fund', 500);

    if (data.initialBalance && data.initialBalance > 0) {
      const initialCents = parsePositiveAmount(data.initialBalance);
      await tx.insert(transactions).values({
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

    return fund;
  });
}

export async function updateFund(id: string, data: UpdateFundData) {
  const db = getDb();

  const [existing] = await db.select().from(funds).where(eq(funds.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Fund');

  const updateFields: Record<string, unknown> = {};
  if (data.name !== undefined) updateFields.name = data.name;
  if (data.type !== undefined) updateFields.type = data.type;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.currency !== undefined) updateFields.currency = data.currency;
  if (data.handlingOfficer !== undefined) updateFields.handlingOfficer = data.handlingOfficer;
  if (data.accountNumber !== undefined) updateFields.accountNumber = data.accountNumber;
  if (data.linkedProjectId !== undefined) updateFields.linkedProjectId = data.linkedProjectId;

  if (Object.keys(updateFields).length === 0) return existing;

  const [updated] = await db.update(funds).set(updateFields).where(eq(funds.id, id)).returning();
  return updated;
}
