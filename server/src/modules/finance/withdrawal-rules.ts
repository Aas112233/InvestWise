import { getDb } from '../../config/database.js';
import { members, systemSettings, funds, transactions, auditLogs } from '../../db/schema/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { fromCents, toCents } from '@/lib/money';
import crypto from 'node:crypto';

/**
 * Withdrawal governance rules.
 *
 * Every query here is tenant-scoped and every amount is integer cents until it
 * leaves as a decimal string. The reads used to run unscoped: the settings row
 * was a global `limit(1)` (another tenant's withdrawal cap), the surplus pool
 * summed EVERY tenant's active funds, and the rows were inserted with no
 * `tenantId` at all — invisible to every tenant filter in the app.
 */

export interface WithdrawalValidationResult {
  allowed: boolean;
  // Money crosses this boundary as decimal(15,2) strings, never floats (§12).
  maxAllowed: string;
  currentContributed: string;
  noticeRequired: boolean;
  noticeDays: number;
  fundBalance: string;
  fundMinBalance: string;
  blockReasons: string[];
}

export interface MemberExitSettlement {
  memberId: string;
  memberName: string;
  totalContributed: string;
  shares: number;
  totalShares: number;
  shareOfSurplus: string;
  grossSettlement: string;
  taxDeduction: string;
  netSettlement: string;
}

export interface ExecuteWithdrawalInput {
  memberId: string;
  fundId: string;
  amount: string | number;
  description?: string;
  withdrawalMethod?: string;
}

export interface ExecuteExitSettlementInput {
  memberId: string;
  fundId: string;
  reason?: string;
  paymentMethod?: string;
}

/** Percent limits in 1e-2 units so the cap is an exact integer division. */
function limitCents(contributedCents: number, percent: string | number | null | undefined): number {
  const pctCents = toCents(typeof percent === 'number' ? String(percent) : (percent ?? '0'));
  return Math.floor((contributedCents * pctCents + 5000) / 10_000);
}

export async function validateWithdrawal(
  tenantId: string,
  memberId: string,
  requestedAmount: string | number,
  fundId?: string,
): Promise<WithdrawalValidationResult> {
  const db = getDb();
  const blockReasons: string[] = [];

  const [member] = await db
    .select({
      name: members.name,
      totalContributed: members.totalContributed,
      shares: members.shares,
      status: members.status,
    })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);

  if (!member) throw new NotFoundError('Member');
  if (member.status !== 'active') blockReasons.push('Member is not active');

  // This tenant's own settings row.
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);
  const noticeDays = Number(settings?.withdrawalNoticeDays ?? 30);
  const contributedCents = toCents(member.totalContributed ?? '0');
  const maxByPctCents = limitCents(contributedCents, settings?.withdrawalLimitPercent ?? '25');
  const absoluteCapCents = toCents(String(settings?.maxWithdrawalPerRequest ?? '100000'));
  const maxAllowedCents = Math.min(maxByPctCents, absoluteCapCents);

  const requestedCents = toCents(requestedAmount);
  if (requestedCents <= 0) blockReasons.push('Requested amount must be greater than 0');
  if (requestedCents > maxAllowedCents) {
    blockReasons.push(
      `Exceeds max allowed ${fromCents(maxAllowedCents)} (limit ${settings?.withdrawalLimitPercent ?? '25'}% of ${fromCents(contributedCents)}, capped at ${fromCents(absoluteCapCents)})`,
    );
  }
  if (requestedCents > contributedCents) {
    blockReasons.push(`Exceeds total contribution balance ${fromCents(contributedCents)}`);
  }

  let fundBalanceCents = 0;
  let fundMinBalanceCents = 0;

  if (fundId) {
    const [fund] = await db
      .select({ balance: funds.balance, minimumBalance: funds.minimumBalance, type: funds.type })
      .from(funds)
      .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
      .limit(1);

    if (fund) {
      fundBalanceCents = toCents(fund.balance ?? '0');
      fundMinBalanceCents = toCents(fund.minimumBalance ?? '0');
      if (fundBalanceCents - requestedCents < fundMinBalanceCents) {
        blockReasons.push(`Drops fund below minimum reserve of ${fromCents(fundMinBalanceCents)}`);
      }
      if ((fund.type ?? '').toUpperCase() === 'PROJECT') {
        blockReasons.push('Cannot withdraw directly from a PROJECT dedicated fund');
      }
    } else {
      blockReasons.push('Target fund not found');
    }
  }

  return {
    allowed: blockReasons.length === 0,
    maxAllowed: fromCents(maxAllowedCents),
    currentContributed: fromCents(contributedCents),
    noticeRequired: requestedCents > Math.floor(maxAllowedCents / 2),
    noticeDays,
    fundBalance: fromCents(fundBalanceCents),
    fundMinBalance: fromCents(fundMinBalanceCents),
    blockReasons,
  };
}

export async function calculateExitSettlement(tenantId: string, memberId: string): Promise<MemberExitSettlement> {
  const db = getDb();
  const [member] = await db
    .select({ name: members.name, totalContributed: members.totalContributed, shares: members.shares })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);

  if (!member) throw new NotFoundError('Member');

  // Totals are aggregated by Postgres inside the tenant, in exact numeric.
  // These used to be unscoped JS reductions over every tenant's members and
  // funds, so an exit settlement could be calculated from another
  // organization's pooled cash.
  const [shareAgg] = await db
    .select({ total: sql<number>`COALESCE(SUM(${members.shares}), 0)::int` })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.status, 'active')));
  const totalShares = Number(shareAgg?.total ?? 0);

  const [fundAgg] = await db
    .select({ total: sql<string>`COALESCE(SUM(${funds.balance}::numeric), 0)::numeric(15,2)` })
    .from(funds)
    .where(and(eq(funds.tenantId, tenantId), eq(funds.status, 'ACTIVE')));
  const poolCents = toCents(fundAgg?.total ?? '0');

  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  const memberShares = member.shares ?? 0;
  const contributedCents = toCents(member.totalContributed ?? '0');

  // The surplus pool is what remains after the statutory reserve is held back.
  const reservePctCents = limitCents(10_000, settings?.statutoryReservePercent ?? '10');
  const distributableCents = poolCents - Math.floor((poolCents * reservePctCents) / 10_000);

  // Rounded down: an exit must never claim a cent more than its share of the
  // pool, or the last member out would overdraw everyone still invested.
  const shareOfSurplusCents =
    totalShares > 0 ? Math.floor((distributableCents * memberShares) / totalShares) : 0;
  const grossCents = contributedCents + shareOfSurplusCents;
  const taxCents = limitCents(grossCents, settings?.taxRate ?? '15');
  const netCents = grossCents - taxCents;

  return {
    memberId,
    memberName: member.name ?? '',
    totalContributed: fromCents(contributedCents),
    shares: memberShares,
    totalShares,
    shareOfSurplus: fromCents(shareOfSurplusCents),
    grossSettlement: fromCents(grossCents),
    taxDeduction: fromCents(taxCents),
    netSettlement: fromCents(netCents),
  };
}

export async function executeWithdrawal(
  tenantId: string,
  input: ExecuteWithdrawalInput,
  userId: string,
  userName: string,
) {
  const db = getDb();
  const amountCents = toCents(input.amount);
  const referenceNumber = `WD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  return db.transaction(async (tx) => {
    // 1. Lock member and fund rows for update, both inside the tenant, to
    // prevent race conditions.
    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.tenantId, tenantId)))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');
    if (member.status !== 'active') throw new AppError('Member is not active', 400, 'INACTIVE_MEMBER');

    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, input.fundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);

    if (!fund) throw new NotFoundError('Fund');
    if ((fund.type ?? '').toUpperCase() === 'PROJECT') {
      throw new AppError('Cannot withdraw from a PROJECT fund', 400, 'PROJECT_FUND_RESTRICTION');
    }

    const validation = await validateWithdrawal(tenantId, input.memberId, input.amount, input.fundId);
    if (!validation.allowed) {
      throw new AppError(`Withdrawal rejected: ${validation.blockReasons.join('; ')}`, 400, 'WITHDRAWAL_VALIDATION_FAILED');
    }

    const fundBeforeCents = toCents(fund.balance ?? '0');
    const fundAfterCents = fundBeforeCents - amountCents;
    const contributedBeforeCents = toCents(member.totalContributed ?? '0');
    const contributedAfterCents = Math.max(0, contributedBeforeCents - amountCents);
    const now = new Date();

    // Fund and member mutations are applied DB-side in exact numeric, with the
    // §6 tenant predicate re-asserted on both writes.
    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric - ${fromCents(amountCents)}::numeric)::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, input.fundId), eq(funds.tenantId, tenantId)));

    await tx
      .update(members)
      .set({
        totalContributed: sql`GREATEST(0, (${members.totalContributed}::numeric - ${fromCents(amountCents)}::numeric))::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(members.id, input.memberId), eq(members.tenantId, tenantId)));

    // Insert transaction — previously written with no tenantId, which left the
    // payout invisible to every tenant-scoped ledger query.
    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Withdrawal',
        amount: fromCents(amountCents),
        description: input.description || `Member Withdrawal for ${member.name}`,
        memberId: input.memberId,
        fundId: input.fundId,
        referenceNumber,
        date: now,
        status: 'Completed',
        depositMethod: input.withdrawalMethod || 'Bank Transfer',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fromCents(fundBeforeCents),
        balanceAfter: fromCents(fundAfterCents),
      })
      .returning();
    if (!txn) throw new AppError('Withdrawal could not be recorded', 500, 'WITHDRAWAL_INSERT_FAILED');

    // Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'MEMBER_WITHDRAWAL',
      resourceType: 'Transaction',
      resourceId: txn.id,
      details: {
        memberId: input.memberId,
        memberName: member.name,
        amount: fromCents(amountCents),
        fundId: input.fundId,
        fundName: fund.name,
        referenceNumber,
      },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      memberContributedBefore: fromCents(contributedBeforeCents),
      memberContributedAfter: fromCents(contributedAfterCents),
      fundBalanceBefore: fromCents(fundBeforeCents),
      fundBalanceAfter: fromCents(fundAfterCents),
    };
  });
}

export async function executeMemberExitSettlement(
  tenantId: string,
  input: ExecuteExitSettlementInput,
  userId: string,
  userName: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const settlement = await calculateExitSettlement(tenantId, input.memberId);

    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.tenantId, tenantId)))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');
    if (member.status !== 'active') throw new AppError('Member is not active', 400, 'INACTIVE_MEMBER');

    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, input.fundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);

    if (!fund) throw new NotFoundError('Payout fund');

    // The settlement was priced from the committed books. Under these locks,
    // re-check the two inputs it depended on, so a deposit or share movement
    // that landed in between cannot be paid out on a stale figure.
    if (toCents(member.totalContributed ?? '0') !== toCents(settlement.totalContributed)) {
      throw new AppError('Member balance changed during settlement. Re-run the settlement.', 409, 'SETTLEMENT_STALE');
    }
    if (Number(member.shares) !== settlement.shares) {
      throw new AppError('Member shares changed during settlement. Re-run the settlement.', 409, 'SETTLEMENT_STALE');
    }

    const payoutCents = toCents(settlement.netSettlement);
    const fundBeforeCents = toCents(fund.balance ?? '0');
    const fundMinCents = toCents(fund.minimumBalance ?? '0');

    if (fundBeforeCents - payoutCents < fundMinCents) {
      throw new AppError(
        `Insufficient fund reserve. Required payout: ${fromCents(payoutCents)}, Available above minimum reserve: ${fromCents(fundBeforeCents - fundMinCents)}`,
        400,
        'INSUFFICIENT_FUND_RESERVE',
      );
    }

    const now = new Date();
    const batchId = `EXIT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // 1. Debit payout fund (§6 tenant predicate on the write).
    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric - ${fromCents(payoutCents)}::numeric)::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, input.fundId), eq(funds.tenantId, tenantId)));

    // 2. Update member: zero out contributions and shares, deactivate
    await tx
      .update(members)
      .set({
        totalContributed: '0.00',
        shares: 0,
        status: 'inactive',
        updatedAt: now,
      })
      .where(and(eq(members.id, input.memberId), eq(members.tenantId, tenantId)));

    // 3. Create disbursement transaction
    const [txn] = await tx
      .insert(transactions)
      .values({
        tenantId,
        type: 'Withdrawal',
        amount: fromCents(payoutCents),
        description: `Member Exit Final Settlement: ${member.name} [Gross: ${settlement.grossSettlement}, Tax: ${settlement.taxDeduction}, Surplus: ${settlement.shareOfSurplus}] - Reason: ${input.reason || 'Account Exit'}`,
        memberId: input.memberId,
        fundId: input.fundId,
        referenceNumber: batchId,
        date: now,
        status: 'Completed',
        depositMethod: input.paymentMethod || 'Bank Transfer',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fromCents(fundBeforeCents),
        balanceAfter: fromCents(fundBeforeCents - payoutCents),
      })
      .returning();
    if (!txn) throw new AppError('Settlement could not be recorded', 500, 'SETTLEMENT_INSERT_FAILED');

    // 4. Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'MEMBER_EXIT_SETTLEMENT',
      resourceType: 'Member',
      resourceId: input.memberId,
      details: {
        batchId,
        memberId: input.memberId,
        memberName: member.name,
        settlement,
        fundId: input.fundId,
        fundName: fund.name,
        reason: input.reason,
      },
      status: 'SUCCESS',
    });

    return {
      batchId,
      settlement,
      transactionId: txn.id,
      message: `Member ${member.name} successfully settled and deactivated. Net disbursement: ${fromCents(payoutCents)}`,
    };
  });
}
