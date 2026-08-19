import { getDb } from '../../config/database.js';
import {
  fiscalPeriods,
  profitAllocations,
  members,
  funds,
  transactions,
  auditLogs,
} from '../../db/schema/index.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { NotFoundError, AppError } from '../../shared/errors.js';

export async function executeProfitAllocation(
  fiscalPeriodId: string,
  sourceFundId: string,
  customAmount?: number,
  userId?: string,
  userName?: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. Fetch fiscal period
    const [period] = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, fiscalPeriodId))
      .for('update')
      .limit(1);

    if (!period) throw new NotFoundError('Fiscal period');

    // 2. Fetch source fund
    const [fund] = await tx
      .select()
      .from(funds)
      .where(eq(funds.id, sourceFundId))
      .for('update')
      .limit(1);

    if (!fund) throw new NotFoundError('Source fund');
    if (fund.status !== 'ACTIVE') throw new AppError('Source fund is not active', 400, 'INACTIVE_FUND');

    // Determine amount to distribute
    const amountToDistribute = customAmount && customAmount > 0
      ? customAmount
      : Number(period.distributableSurplus ?? 0);

    if (amountToDistribute <= 0) {
      throw new AppError('Distributable surplus must be greater than zero', 400, 'ZERO_DISTRIBUTION');
    }

    const fundBal = Number(fund.balance);
    const fundMin = Number(fund.minimumBalance ?? 0);

    if (fundBal - amountToDistribute < fundMin) {
      throw new AppError(
        `Insufficient fund liquidity. Required: ${amountToDistribute.toFixed(2)}, Available above minimum reserve: ${(fundBal - fundMin).toFixed(2)}`,
        400,
        'INSUFFICIENT_LIQUIDITY',
      );
    }

    // 3. Get active members with positive shares
    const activeMembers = await tx
      .select()
      .from(members)
      .where(and(eq(members.status, 'active'), sql`${members.shares} > 0`));

    const totalActiveShares = activeMembers.reduce((sum, m) => sum + Number(m.shares), 0);
    if (totalActiveShares === 0) {
      throw new AppError('No active shares found for allocation', 400, 'NO_ACTIVE_SHARES');
    }

    const ratePerShare = amountToDistribute / totalActiveShares;
    const batchId = `ALLOC-${period.year}-${Date.now()}`;

    let totalDisbursed = 0;
    const allocationInserts: Array<typeof profitAllocations.$inferInsert> = [];
    const transactionInserts: Array<typeof transactions.$inferInsert> = [];

    for (const member of activeMembers) {
      const memberShares = Number(member.shares);
      const memberPayout = Math.floor(memberShares * ratePerShare * 100) / 100;
      if (memberPayout <= 0) continue;

      totalDisbursed += memberPayout;

      allocationInserts.push({
        fiscalPeriodId: period.id,
        memberId: member.id,
        allocationType: 'ANNUAL_SURPLUS',
        amount: memberPayout.toFixed(2),
        sharesAtTime: memberShares,
        ratePerShare: ratePerShare.toFixed(6),
        notes: `Fiscal Year ${period.year} Profit Distribution [${batchId}]`,
        allocatedBy: userId,
      });

      transactionInserts.push({
        type: 'Dividend',
        amount: memberPayout.toFixed(2),
        description: `Fiscal Year ${period.year} Profit Allocation [${batchId}]`,
        memberId: member.id,
        fundId: sourceFundId,
        status: 'Completed',
        referenceNumber: batchId,
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName || 'System',
      });
    }

    if (allocationInserts.length === 0) {
      throw new AppError('Calculated distribution per member is too small', 400, 'DISTRIBUTION_TOO_SMALL');
    }

    // Debit source fund atomically
    await tx
      .update(funds)
      .set({
        balance: sql<string>`(${funds.balance}::numeric - ${totalDisbursed})::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(eq(funds.id, sourceFundId));

    // Update fiscal period actualDistributed & retainedEarnings
    const retained = Math.max(0, amountToDistribute - totalDisbursed);
    await tx
      .update(fiscalPeriods)
      .set({
        actualDistributed: sql<string>`(${fiscalPeriods.actualDistributed}::numeric + ${totalDisbursed})::numeric(15,2)`,
        retainedEarnings: sql<string>`(${fiscalPeriods.retainedEarnings}::numeric + ${retained})::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(eq(fiscalPeriods.id, fiscalPeriodId));

    // Insert allocations and transactions
    await tx.insert(profitAllocations).values(allocationInserts);
    await tx.insert(transactions).values(transactionInserts);

    // Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'EXECUTE_PROFIT_ALLOCATION',
      resourceType: 'FiscalPeriod',
      resourceId: fiscalPeriodId,
      details: {
        batchId,
        year: period.year,
        totalDisbursed,
        ratePerShare,
        totalActiveShares,
        recipientsCount: allocationInserts.length,
        fundId: sourceFundId,
      },
      status: 'SUCCESS',
    });

    return {
      batchId,
      year: period.year,
      totalDisbursed,
      ratePerShare,
      recipientsCount: allocationInserts.length,
      residualRetained: retained,
    };
  });
}

export async function listProfitAllocations(fiscalPeriodId: string) {
  const db = getDb();

  const rows = await db
    .select({
      id: profitAllocations.id,
      fiscalPeriodId: profitAllocations.fiscalPeriodId,
      memberId: profitAllocations.memberId,
      allocationType: profitAllocations.allocationType,
      amount: profitAllocations.amount,
      sharesAtTime: profitAllocations.sharesAtTime,
      ratePerShare: profitAllocations.ratePerShare,
      notes: profitAllocations.notes,
      allocatedAt: profitAllocations.allocatedAt,
      memberName: members.name,
      memberDisplayId: members.memberId,
    })
    .from(profitAllocations)
    .leftJoin(members, eq(profitAllocations.memberId, members.id))
    .where(eq(profitAllocations.fiscalPeriodId, fiscalPeriodId))
    .orderBy(desc(profitAllocations.allocatedAt));

  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    ratePerShare: Number(r.ratePerShare),
  }));
}
