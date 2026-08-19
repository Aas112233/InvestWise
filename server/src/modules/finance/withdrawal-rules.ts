import { getDb } from '../../config/database.js';
import { members, systemSettings, funds, transactions, auditLogs } from '../../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../shared/errors.js';

export interface WithdrawalValidationResult {
  allowed: boolean;
  maxAllowed: number;
  currentContributed: number;
  noticeRequired: boolean;
  noticeDays: number;
  fundBalance: number;
  fundMinBalance: number;
  blockReasons: string[];
}

export interface MemberExitSettlement {
  memberId: string;
  memberName: string;
  totalContributed: number;
  shares: number;
  totalShares: number;
  shareOfSurplus: number;
  grossSettlement: number;
  taxDeduction: number;
  netSettlement: number;
}

export interface ExecuteWithdrawalInput {
  memberId: string;
  fundId: string;
  amount: number;
  description?: string;
  withdrawalMethod?: string;
}

export interface ExecuteExitSettlementInput {
  memberId: string;
  fundId: string;
  reason?: string;
  paymentMethod?: string;
}

export async function validateWithdrawal(
  memberId: string,
  requestedAmount: number,
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
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) throw new NotFoundError('Member');
  if (member.status !== 'active') blockReasons.push('Member is not active');

  const [settings] = await db.select().from(systemSettings).limit(1);
  const pct = Number(settings?.withdrawalLimitPercent ?? 25);
  const noticeDays = Number(settings?.withdrawalNoticeDays ?? 30);
  const maxAbs = Number(settings?.maxWithdrawalPerRequest ?? 100000);
  const contributed = Number(member.totalContributed ?? 0);
  const maxByPct = (contributed * pct) / 100;
  const maxAllowed = Math.min(maxByPct, maxAbs);

  if (requestedAmount <= 0) blockReasons.push('Requested amount must be greater than 0');
  if (requestedAmount > maxAllowed) {
    blockReasons.push(`Exceeds max allowed ${maxAllowed.toFixed(2)} (${pct}% of ${contributed.toFixed(2)})`);
  }
  if (requestedAmount > contributed) {
    blockReasons.push(`Exceeds total contribution balance ${contributed.toFixed(2)}`);
  }

  let fundBalance = 0;
  let fundMinBalance = 0;

  if (fundId) {
    const [fund] = await db
      .select({ balance: funds.balance, minimumBalance: funds.minimumBalance, type: funds.type })
      .from(funds)
      .where(eq(funds.id, fundId))
      .limit(1);

    if (fund) {
      fundBalance = Number(fund.balance);
      fundMinBalance = Number(fund.minimumBalance ?? 0);
      if (fundBalance - requestedAmount < fundMinBalance) {
        blockReasons.push(`Drops fund below minimum reserve of ${fundMinBalance.toFixed(2)}`);
      }
      if (fund.type === 'PROJECT') {
        blockReasons.push('Cannot withdraw directly from a PROJECT dedicated fund');
      }
    } else {
      blockReasons.push('Target fund not found');
    }
  }

  return {
    allowed: blockReasons.length === 0,
    maxAllowed,
    currentContributed: contributed,
    noticeRequired: requestedAmount > maxAllowed * 0.5,
    noticeDays,
    fundBalance,
    fundMinBalance,
    blockReasons,
  };
}

export async function calculateExitSettlement(memberId: string): Promise<MemberExitSettlement> {
  const db = getDb();
  const [member] = await db
    .select({ name: members.name, totalContributed: members.totalContributed, shares: members.shares })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) throw new NotFoundError('Member');

  const shareRows = await db
    .select({ shares: members.shares })
    .from(members)
    .where(eq(members.status, 'active'));

  const totalShares = shareRows.reduce((s, r) => s + (r.shares ?? 0), 0);
  const [settings] = await db.select().from(systemSettings).limit(1);
  const taxRate = Number(settings?.taxRate ?? 15) / 100;

  const fundRows = await db
    .select({ balance: funds.balance })
    .from(funds)
    .where(eq(funds.status, 'ACTIVE'));

  const totalBalance = fundRows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const reservePct = Number(settings?.statutoryReservePercent ?? 10) / 100;
  const distributable = Math.max(0, totalBalance * (1 - reservePct));
  const memberShares = member.shares ?? 0;
  const shareOfSurplus = totalShares > 0 ? (memberShares / totalShares) * distributable : 0;
  const gross = Number(member.totalContributed ?? 0) + shareOfSurplus;
  const tax = gross * taxRate;

  return {
    memberId,
    memberName: member.name ?? '',
    totalContributed: Number(member.totalContributed ?? 0),
    shares: memberShares,
    totalShares,
    shareOfSurplus: Math.round(shareOfSurplus * 100) / 100,
    grossSettlement: Math.round(gross * 100) / 100,
    taxDeduction: Math.round(tax * 100) / 100,
    netSettlement: Math.round((gross - tax) * 100) / 100,
  };
}

export async function executeWithdrawal(
  input: ExecuteWithdrawalInput,
  userId: string,
  userName: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. Lock member and fund rows for update to prevent race conditions
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, input.memberId))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');
    if (member.status !== 'active') throw new AppError('Member is not active', 400, 'INACTIVE_MEMBER');

    const [fund] = await tx
      .select()
      .from(funds)
      .where(eq(funds.id, input.fundId))
      .for('update')
      .limit(1);

    if (!fund) throw new NotFoundError('Fund');
    if (fund.type === 'PROJECT') throw new AppError('Cannot withdraw from a PROJECT fund', 400, 'PROJECT_FUND_RESTRICTION');

    const validation = await validateWithdrawal(input.memberId, input.amount, input.fundId);
    if (!validation.allowed) {
      throw new AppError(`Withdrawal rejected: ${validation.blockReasons.join('; ')}`, 400, 'WITHDRAWAL_VALIDATION_FAILED');
    }

    const amount = Number(input.amount);
    const fundBalBefore = Number(fund.balance);
    const fundBalAfter = fundBalBefore - amount;
    const memberContributedBefore = Number(member.totalContributed ?? 0);
    const memberContributedAfter = Math.max(0, memberContributedBefore - amount);

    // Atomic fund update
    await tx
      .update(funds)
      .set({
        balance: sql<string>`(${funds.balance}::numeric - ${amount})::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(eq(funds.id, input.fundId));

    // Atomic member contribution update
    await tx
      .update(members)
      .set({
        totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${amount}))::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(eq(members.id, input.memberId));

    // Insert transaction
    const [txn] = await tx
      .insert(transactions)
      .values({
        type: 'Withdrawal',
        amount: amount.toFixed(2),
        description: input.description || `Member Withdrawal for ${member.name}`,
        memberId: input.memberId,
        fundId: input.fundId,
        date: new Date(),
        status: 'Completed',
        depositMethod: input.withdrawalMethod || 'Bank Transfer',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fundBalBefore.toFixed(2),
        balanceAfter: fundBalAfter.toFixed(2),
      })
      .returning();

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
        amount,
        fundId: input.fundId,
        fundName: fund.name,
      },
      status: 'SUCCESS',
    });

    return {
      ...txn,
      amount,
      memberContributedBefore,
      memberContributedAfter,
      fundBalanceBefore: fundBalBefore,
      fundBalanceAfter: fundBalAfter,
    };
  });
}

export async function executeMemberExitSettlement(
  input: ExecuteExitSettlementInput,
  userId: string,
  userName: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const settlement = await calculateExitSettlement(input.memberId);

    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, input.memberId))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');
    if (member.status !== 'active') throw new AppError('Member is not active', 400, 'INACTIVE_MEMBER');

    const [fund] = await tx
      .select()
      .from(funds)
      .where(eq(funds.id, input.fundId))
      .for('update')
      .limit(1);

    if (!fund) throw new NotFoundError('Payout fund');

    const payoutAmount = settlement.netSettlement;
    const fundBal = Number(fund.balance);
    const fundMin = Number(fund.minimumBalance ?? 0);

    if (fundBal - payoutAmount < fundMin) {
      throw new AppError(
        `Insufficient fund reserve. Required payout: ${payoutAmount.toFixed(2)}, Available above minimum reserve: ${(fundBal - fundMin).toFixed(2)}`,
        400,
        'INSUFFICIENT_FUND_RESERVE',
      );
    }

    const batchId = `EXIT-${Date.now()}`;

    // 1. Debit payout fund
    await tx
      .update(funds)
      .set({
        balance: sql<string>`(${funds.balance}::numeric - ${payoutAmount})::numeric(15,2)`,
        updatedAt: new Date(),
      })
      .where(eq(funds.id, input.fundId));

    // 2. Update member: zero out contributions and shares, deactivate
    await tx
      .update(members)
      .set({
        totalContributed: '0.00',
        shares: 0,
        status: 'inactive',
        updatedAt: new Date(),
      })
      .where(eq(members.id, input.memberId));

    // 3. Create disbursement transaction
    const [txn] = await tx
      .insert(transactions)
      .values({
        type: 'Withdrawal',
        amount: payoutAmount.toFixed(2),
        description: `Member Exit Final Settlement: ${member.name} [Gross: ${settlement.grossSettlement.toFixed(2)}, Tax: ${settlement.taxDeduction.toFixed(2)}, Surplus: ${settlement.shareOfSurplus.toFixed(2)}] - Reason: ${input.reason || 'Account Exit'}`,
        memberId: input.memberId,
        fundId: input.fundId,
        referenceNumber: batchId,
        status: 'Completed',
        depositMethod: input.paymentMethod || 'Bank Transfer',
        authorizedBy: userId,
        createdBy: userId,
        updatedBy: userId,
        handlingOfficer: userName,
        balanceBefore: fundBal.toFixed(2),
        balanceAfter: (fundBal - payoutAmount).toFixed(2),
      })
      .returning();

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
        reason: input.reason,
      },
      status: 'SUCCESS',
    });

    return {
      batchId,
      settlement,
      transactionId: txn.id,
      message: `Member ${member.name} successfully settled and deactivated. Net disbursement: ${payoutAmount.toFixed(2)}`,
    };
  });
}
