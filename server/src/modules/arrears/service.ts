import { getDb } from '../../config/database.js';
import { memberArrears, members, transactions, auditLogs, systemSettings } from '../../db/schema/index.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { NotFoundError, AppError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';

export async function calculateMonthlyArrears(
  periodKey?: string,
  monthlyDueAmount?: number,
  userId?: string,
  userName?: string,
  tenantId?: string,
) {
  const db = getDb();
  const now = new Date();
  const targetPeriod = periodKey || now.toISOString().slice(0, 7); // YYYY-MM
  const [yearStr, monthStr] = targetPeriod.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    throw new AppError('Invalid periodKey format. Expected YYYY-MM', 400, 'INVALID_PERIOD');
  }

  // Get default monthly due from tenant settings if not passed
  let requiredAmount = monthlyDueAmount;
  if (!requiredAmount || requiredAmount <= 0) {
    const settingsQuery = tenantId
      ? db.select().from(systemSettings).where(eq(systemSettings.tenantId, tenantId)).limit(1)
      : db.select().from(systemSettings).limit(1);
    const [settings] = await settingsQuery;
    requiredAmount = Number(settings?.shareValueBdt ?? 1000);
  }

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  // Fetch all active members (scoped by tenant if tenantId is provided)
  const memberConditions = [eq(members.status, 'active')];
  if (tenantId) {
    memberConditions.push(eq(members.tenantId, tenantId));
  }
  const activeMembers = await db
    .select({
      id: members.id,
      name: members.name,
      memberId: members.memberId,
      shares: members.shares,
    })
    .from(members)
    .where(and(...memberConditions));

  const results: Array<{ memberId: string; name: string; required: number; deposited: number; shortfall: number; status: string }> = [];

  // Batch sum deposits for all members in this month + fetch existing arrears
  // rows concurrently (these two reads are independent).
  const [depositAggRows, existingArrears] = await Promise.all([
    activeMembers.length === 0
      ? (Promise.resolve([]) as Promise<Array<{ memberId: string | null; total: string }>>)
      : db
          .select({
            memberId: transactions.memberId,
            total: sql<string>`COALESCE(SUM(${transactions.amount}), '0.00')`,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.memberId, activeMembers.map((m) => m.id)),
              eq(transactions.type, 'Deposit'),
              inArray(transactions.status, ['Completed']),
              eq(transactions.isDeleted, false),
              sql`${transactions.date} >= ${startOfMonth.toISOString()}::timestamptz`,
              sql`${transactions.date} <= ${endOfMonth.toISOString()}::timestamptz`,
            ),
          )
          .groupBy(transactions.memberId),
    db
      .select({ id: memberArrears.id, memberId: memberArrears.memberId, currentStatus: memberArrears.status })
      .from(memberArrears)
      .where(eq(memberArrears.periodKey, targetPeriod)),
  ]);

  const depositMap = new Map(depositAggRows.map((r) => [r.memberId, Number(r.total)]));

  const existingMap = new Map(existingArrears.map((a) => [a.memberId, a]));

  // Compute per-member arrears in memory first, then write in at most 2
  // batched statements (one grouped UPDATE for existing rows + one multi-row
  // INSERT for new rows) inside a transaction. Previously this loop issued
  // one round trip PER member and ran without a transaction, so a mid-loop
  // failure could leave partially recalculated rows behind.
  const updateRows: Array<{
    id: string;
    required: string;
    deposited: string;
    shortfall: string;
    status: string;
  }> = [];
  const insertRows: Array<typeof memberArrears.$inferInsert> = [];

  for (const m of activeMembers) {
    const actualDeposited = depositMap.get(m.id) ?? 0;
    // Member required amount is proportional to their shares (minimum 1 share)
    const memberRequired = requiredAmount * Math.max(1, Number(m.shares || 1));
    const shortfall = Math.max(0, memberRequired - actualDeposited);
    const status = shortfall === 0 ? 'PAID' : 'OUTSTANDING';

    const existing = existingMap.get(m.id);

    if (existing) {
      // If already WAIVED, don't overwrite with OUTSTANDING
      if (existing.currentStatus !== 'WAIVED') {
        updateRows.push({
          id: existing.id,
          required: memberRequired.toFixed(2),
          deposited: actualDeposited.toFixed(2),
          shortfall: shortfall.toFixed(2),
          status,
        });
      }
    } else {
      insertRows.push({
        tenantId: tenantId ?? null,
        memberId: m.id,
        periodKey: targetPeriod,
        requiredAmount: memberRequired.toFixed(2),
        actualDeposited: actualDeposited.toFixed(2),
        shortfall: shortfall.toFixed(2),
        status,
      });
    }

    results.push({
      memberId: m.id,
      name: m.name,
      required: memberRequired,
      deposited: actualDeposited,
      shortfall,
      status,
    });
  }

  await db.transaction(async (tx) => {
    if (updateRows.length > 0) {
      // Grouped update via a VALUES join: one statement regardless of how
      // many members are being recalculated.
      await tx.execute(sql`
        UPDATE ${memberArrears} AS ma
        SET required_amount = v.required_amount,
            actual_deposited = v.actual_deposited,
            shortfall = v.shortfall,
            status = v.status,
            updated_at = now()
        FROM (VALUES ${sql.join(
          updateRows.map(
            (u) =>
              sql`(${u.id}::uuid, ${u.required}::numeric, ${u.deposited}::numeric, ${u.shortfall}::numeric, ${u.status}::varchar)`,
          ),
          sql`, `,
        )}) AS v(id, required_amount, actual_deposited, shortfall, status)
        WHERE ma.id = v.id
      `);
    }

    if (insertRows.length > 0) {
      await tx.insert(memberArrears).values(insertRows);
    }

    if (userId) {
      await tx.insert(auditLogs).values({
        userId,
        userName: userName || 'System',
        action: 'CALCULATE_MONTHLY_ARREARS',
        resourceType: 'Finance',
        details: {
          periodKey: targetPeriod,
          totalMembersProcessed: activeMembers.length,
          outstandingCount: results.filter((r) => r.status === 'OUTSTANDING').length,
        },
        status: 'SUCCESS',
      });
    }
  });

  return {
    periodKey: targetPeriod,
    totalProcessed: results.length,
    outstandingCount: results.filter((r) => r.status === 'OUTSTANDING').length,
    paidCount: results.filter((r) => r.status === 'PAID').length,
    results,
  };
}

export async function listArrears(query: Record<string, string | undefined>) {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(query);

  const conditions = [];

  if (query.periodKey) {
    conditions.push(eq(memberArrears.periodKey, query.periodKey));
  }
  if (query.status) {
    conditions.push(eq(memberArrears.status, query.status));
  }
  if (query.memberId) {
    conditions.push(eq(memberArrears.memberId, query.memberId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(memberArrears)
    .where(whereClause);

  const total = Number(countResult?.count ?? 0);

  const rows = await db
    .select({
      id: memberArrears.id,
      memberId: memberArrears.memberId,
      periodKey: memberArrears.periodKey,
      requiredAmount: memberArrears.requiredAmount,
      actualDeposited: memberArrears.actualDeposited,
      shortfall: memberArrears.shortfall,
      status: memberArrears.status,
      waivedReason: memberArrears.waivedReason,
      createdAt: memberArrears.createdAt,
      updatedAt: memberArrears.updatedAt,
      memberName: members.name,
      memberDisplayId: members.memberId,
      memberEmail: members.email,
    })
    .from(memberArrears)
    .leftJoin(members, eq(memberArrears.memberId, members.id))
    .where(whereClause)
    .orderBy(desc(memberArrears.periodKey), desc(memberArrears.shortfall))
    .limit(limit)
    .offset(skip);

  const data = rows.map((r) => ({
    ...r,
    requiredAmount: Number(r.requiredAmount),
    actualDeposited: Number(r.actualDeposited),
    shortfall: Number(r.shortfall),
  }));

  return formatPaginatedResponse(data, page, limit, total);
}

export async function waiveArrear(
  arrearId: string,
  userId: string,
  userName: string,
  reason: string,
) {
  const db = getDb();

  const [arrear] = await db
    .select()
    .from(memberArrears)
    .where(eq(memberArrears.id, arrearId))
    .limit(1);

  if (!arrear) throw new NotFoundError('Arrear record');

  const [updated] = await db
    .update(memberArrears)
    .set({
      status: 'WAIVED',
      waivedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(memberArrears.id, arrearId))
    .returning();

  await db.insert(auditLogs).values({
    userId,
    userName,
    action: 'WAIVE_ARREAR',
    resourceType: 'MemberArrear',
    resourceId: arrearId,
    details: {
      memberId: arrear.memberId,
      periodKey: arrear.periodKey,
      shortfall: Number(arrear.shortfall),
      reason,
    },
    status: 'SUCCESS',
  });

  return updated;
}

export async function getMemberArrearsSummary(memberId: string) {
  const db = getDb();

  const records = await db
    .select()
    .from(memberArrears)
    .where(eq(memberArrears.memberId, memberId))
    .orderBy(desc(memberArrears.periodKey));

  const totalOutstanding = records
    .filter((r) => r.status === 'OUTSTANDING')
    .reduce((sum, r) => sum + Number(r.shortfall), 0);

  return {
    memberId,
    totalOutstanding: Number(totalOutstanding.toFixed(2)),
    recordsCount: records.length,
    outstandingPeriods: records.filter((r) => r.status === 'OUTSTANDING').map((r) => r.periodKey),
    history: records.map((r) => ({
      ...r,
      requiredAmount: Number(r.requiredAmount),
      actualDeposited: Number(r.actualDeposited),
      shortfall: Number(r.shortfall),
    })),
  };
}
