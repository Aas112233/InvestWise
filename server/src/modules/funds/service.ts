import { eq, and, desc, asc, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import { funds, transactions, projects, systemSettings } from '../../db/schema/index';
import { getPaginationParams, formatPaginatedResponse, type SessionUser } from '../../middleware/api';
import { AppError, NotFoundError } from '../../shared/errors';
import { parsePositiveAmount, fromCents, toCents } from '@/lib/money';
import { logAudit } from '@/lib/utils/audit';

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

// Field types match the Zod schema outputs in ./validation (the handler parses
// request bodies with it), so the parsed object flows through uncast.
export interface UpdateFundData {
  name?: string;
  type?: string;
  description?: string | null;
  status?: string;
  currency?: string | null;
  handlingOfficer?: string | null;
  accountNumber?: string | null;
  minimumBalance?: number | string;
  linkedProjectId?: string | null;
}

/**
 * A fund's linked project must belong to the caller's tenant. The uuid column
 * carries no FK (db/schema/funds.ts), and the only reader reconciles
 * tenant-scoped (finance/service.ts), so a foreign id would silently dangle.
 * Same ownership check the goals routes apply (app/api/goals/route.ts).
 */
async function assertProjectInTenant(projectId: string, tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  if (!project) {
    // Deliberately not "not found": the message must not confirm whether the
    // id exists in another tenant.
    throw new AppError('Linked project must belong to your organization', 400, 'INVALID_LINKED_PROJECT');
  }
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

  // A linked project id is only accepted when it resolves inside this tenant.
  // Empty/whitespace means "no link" — the same normalization the Zod schema
  // applies (validation.ts).
  const createLinkedProjectId = data.linkedProjectId?.trim() || null;
  if (createLinkedProjectId) {
    await assertProjectInTenant(createLinkedProjectId, effectiveTenantId);
  }

  const minBalCents = data.minimumBalance ? parsePositiveAmount(data.minimumBalance) : 0;

  // The fund's currency is the tenant's base currency unless the caller names
  // one explicitly — never a hardcoded default (a SAR tenant's funds were
  // being stamped 'BDT', and the funds screen trusts the row's own code).
  let currency = data.currency?.trim().toUpperCase();
  if (!currency) {
    const [settings] = await db
      .select({ baseCurrency: systemSettings.baseCurrency })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, effectiveTenantId))
      .limit(1);
    currency = settings?.baseCurrency || 'BDT';
  }

  const created = await db.transaction(async (tx) => {
    const [fund] = await tx
      .insert(funds)
      .values({
        tenantId: effectiveTenantId,
        name: data.name,
        type: data.type || 'OTHER',
        status: data.status || 'ACTIVE',
        balance: '0',
        minimumBalance: fromCents(minBalCents),
        currency,
        description: data.description ?? null,
        handlingOfficer: data.handlingOfficer ?? null,
        accountNumber: data.accountNumber ?? null,
        linkedProjectId: createLinkedProjectId,
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

  // Fund CRUD is money-container management (account numbers, types, minimum
  // balances) — it belongs in the tenant audit trail. `created` comes from the
  // insert's .returning(): no extra query.
  await logAudit({
    user: { id: user.id, name: user.name },
    tenantId: effectiveTenantId,
    action: 'CREATE_FUND',
    resourceType: 'Fund',
    resourceId: created.id,
    details: {
      name: created.name,
      type: created.type,
      status: created.status,
      currency: created.currency,
      accountNumber: created.accountNumber,
      openingBalance: created.balance,
    },
    after: created,
  });

  return created;
}

// tenantId is REQUIRED (audit 07 L-12): the optional form scoped the update
// only when a caller remembered to pass it — a future omission would have
// updated funds across tenants.
export async function updateFund(id: string, data: UpdateFundData, tenantId: string, user?: SessionUser) {
  const db = getDb();
  const conditions = [eq(funds.id, id), eq(funds.tenantId, tenantId)];

  const [existing] = await db
    .select()
    .from(funds)
    .where(and(...conditions))
    .limit(1);
  if (!existing) throw new NotFoundError('Fund');

  if (data.type === 'PROJECT' && existing.type !== 'PROJECT') {
    throw new AppError('A fund cannot be changed to PROJECT type manually — project funds are created automatically when a project is initialized.', 400, 'PROJECT_FUND_NOT_ALLOWED');
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

  // linkedProjectId: '' / whitespace means unlink (same normalization the Zod
  // schema applies); a non-empty id must resolve inside the caller's tenant.
  const linkedProjectId =
    data.linkedProjectId === undefined
      ? undefined
      : data.linkedProjectId?.trim()
        ? data.linkedProjectId.trim()
        : null;
  if (linkedProjectId) {
    await assertProjectInTenant(linkedProjectId, tenantId);
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

  // Zero extra queries: `existing` is the row this function already fetched
  // for its validation guards; `updated` is the UPDATE's .returning().
  await logAudit({
    user: user ? { id: user.id, name: user.name } : null,
    tenantId: tenantId ?? null,
    action: 'UPDATE_FUND',
    resourceType: 'Fund',
    resourceId: id,
    details: { fields: Object.keys(updateFields).filter((k) => k !== 'updatedAt') },
    before: existing,
    after: updated,
  });

  return updated;
}
