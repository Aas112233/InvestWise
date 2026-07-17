import { getDb } from '../../config/database.js';
import { members, systemSettings, funds } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
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
  memberId: string; memberName: string; totalContributed: number;
  shares: number; totalShares: number; shareOfSurplus: number;
  grossSettlement: number; taxDeduction: number; netSettlement: number;
}

export async function validateWithdrawal(
  memberId: string, requestedAmount: number, fundId?: string,
): Promise<WithdrawalValidationResult> {
  const db = getDb();
  const blockReasons: string[] = [];

  const [member] = await db
    .select({ name: members.name, totalContributed: members.totalContributed, shares: members.shares, status: members.status })
    .from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new NotFoundError('Member');
  if (member.status !== 'active') blockReasons.push('Member is not active');

  const [settings] = await db.select().from(systemSettings).limit(1);
  const pct = Number(settings?.withdrawalLimitPercent ?? 25);
  const noticeDays = Number(settings?.withdrawalNoticeDays ?? 30);
  const maxAbs = Number(settings?.maxWithdrawalPerRequest ?? 100000);
  const contributed = Number(member.totalContributed ?? 0);
  const maxByPct = (contributed * pct) / 100;
  const maxAllowed = Math.min(maxByPct, maxAbs);

  if (requestedAmount > maxAllowed) blockReasons.push(`Exceeds max allowed ${maxAllowed.toFixed(2)} (${pct}% of ${contributed.toFixed(2)})`);
  if (requestedAmount > contributed) blockReasons.push(`Exceeds contribution ${contributed.toFixed(2)}`);

  let fundBalance = 0, fundMinBalance = 0;
  if (fundId) {
    const [fund] = await db.select({ balance: funds.balance, minimumBalance: funds.minimumBalance, type: funds.type }).from(funds).where(eq(funds.id, fundId)).limit(1);
    if (fund) {
      fundBalance = Number(fund.balance); fundMinBalance = Number(fund.minimumBalance ?? 0);
      if (fundBalance - requestedAmount < fundMinBalance) blockReasons.push('Below minimum fund reserve');
      if (fund.type === 'PROJECT') blockReasons.push('Cannot withdraw from PROJECT fund');
    }
  }

  return { allowed: blockReasons.length === 0, maxAllowed, currentContributed: contributed, noticeRequired: requestedAmount > maxAllowed * 0.5, noticeDays, fundBalance, fundMinBalance, blockReasons };
}

export async function calculateExitSettlement(memberId: string): Promise<MemberExitSettlement> {
  const db = getDb();
  const [member] = await db.select({ name: members.name, totalContributed: members.totalContributed, shares: members.shares }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new NotFoundError('Member');
  const shareRows = await db.select({ shares: members.shares }).from(members).where(eq(members.status, 'active'));
  const totalShares = shareRows.reduce((s, r) => s + (r.shares ?? 0), 0);
  const [settings] = await db.select().from(systemSettings).limit(1);
  const taxRate = Number(settings?.taxRate ?? 15) / 100;
  const fundRows = await db.select({ balance: funds.balance }).from(funds).where(eq(funds.status, 'ACTIVE'));
  const totalBalance = fundRows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const reservePct = Number(settings?.statutoryReservePercent ?? 10) / 100;
  const distributable = totalBalance * (1 - reservePct);
  const memberShares = member.shares ?? 0;
  const shareOfSurplus = totalShares > 0 ? (memberShares / totalShares) * distributable : 0;
  const gross = Number(member.totalContributed ?? 0) + shareOfSurplus;
  const tax = gross * taxRate;
  return { memberId, memberName: member.name ?? '', totalContributed: Number(member.totalContributed ?? 0), shares: memberShares, totalShares, shareOfSurplus: Math.round(shareOfSurplus * 100) / 100, grossSettlement: Math.round(gross * 100) / 100, taxDeduction: Math.round(tax * 100) / 100, netSettlement: Math.round((gross - tax) * 100) / 100 };
}
