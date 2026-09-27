import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, funds, systemSettings, transactions } from '@/db/schema/index';
import { eq, and, sql, sum } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import { toCents, fromCents, splitDividendByShares } from '@/lib/money';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check read permission for DIVIDENDS
    if (!hasScreenPermission(user, 'DIVIDENDS', 'READ')) {
      throw new ForbiddenError('Read permission required for: DIVIDENDS');
    }

    const body = await request.json();
    const {
      grossEarnings,
      distributableFundId,
      fiscalPeriodId,
    } = body;

    // Validate required fields
    if (!grossEarnings || !distributableFundId) {
      throw new ValidationError('grossEarnings and distributableFundId are required');
    }

    const gross = parseFloat(grossEarnings);
    if (isNaN(gross) || gross <= 0) {
      throw new ValidationError('Gross earnings must be a positive number');
    }

    // Validate 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(grossEarnings.toString())) {
      throw new ValidationError('Gross earnings must have at most 2 decimal places');
    }

    const formattedGross = gross.toFixed(2);

    const db = getDb();

    // Get system settings for statutory reserve percentage
    const [settings] = await db.select().from(systemSettings).limit(1);
    const statutoryReservePercent = parseFloat(settings?.statutoryReservePercent || '10');
    const formattedReservePercent = statutoryReservePercent.toFixed(2);

    // Get the distributable fund
    const [distributableFund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, distributableFundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!distributableFund) {
      throw new NotFoundError('Distributable fund');
    }

    // Check if fund has sufficient balance
    const fundBalance = parseFloat(distributableFund.balance);
    if (fundBalance < gross) {
      throw new ValidationError(
        `Insufficient fund balance. Available: ${fundBalance.toFixed(2)}, Required: ${formattedGross}`
      );
    }

    // Get reserve fund (type = 'RESERVE')
    const [reserveFund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.type, 'RESERVE'), eq(funds.status, 'ACTIVE'), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    // Get all active members with shares > 0
    const activeMembers = await db
      .select({
        id: members.id,
        memberId: members.memberId,
        name: members.name,
        shares: members.shares,
        totalContributed: members.totalContributed,
      })
      .from(members)
      .where(and(
        eq(members.status, 'active'),
        sql`${members.shares} > 0`,
        tenantId ? eq(members.tenantId, tenantId) : sql`true`
      ))
      .orderBy(members.name);

    // Calculate total active shares
    const totalActiveShares = activeMembers.reduce((sum, m) => sum + m.shares, 0);

    if (totalActiveShares === 0) {
      return NextResponse.json({
        success: true,
        data: {
          grossEarnings: formattedGross,
          statutoryReservePercent: formattedReservePercent,
          statutoryReserveAmount: '0.00',
          netDistributable: formattedGross,
          totalActiveShares: 0,
          ratePerShare: 0,
          reserveFund: reserveFund ? { id: reserveFund.id, name: reserveFund.name } : null,
          distributableFund: { id: distributableFund.id, name: distributableFund.name, balance: distributableFund.balance },
          memberBreakdown: [],
          warning: 'No active members with shares found. Dividend cannot be distributed.',
        },
        message: 'Dividend calculation completed (simulation)',
      });
    }

    // Calculate statutory reserve
    const statutoryReserveAmount = (gross * statutoryReservePercent / 100).toFixed(2);
    const netDistributable = (gross - parseFloat(statutoryReserveAmount)).toFixed(2);

    // Exact split in integer cents — Σ payouts === netDistributable, always.
    // (lib/money.ts largest-remainder is the single canonical dividend math.)
    const netDistributableCents = toCents(netDistributable);
    const payouts = splitDividendByShares(
      netDistributableCents,
      activeMembers.map((m) => ({ id: m.id, shares: m.shares })),
    );
    const payoutByMember = new Map(payouts.map((p) => [p.id, p.payoutCents]));
    // Informational only — per-member amounts come from the exact split above.
    const ratePerShare = netDistributableCents / totalActiveShares;

    // Calculate member breakdown
    const memberBreakdown = activeMembers.map(member => {
      const memberShares = member.shares;
      const grossAmount = fromCents(payoutByMember.get(member.id) ?? 0);
      return {
        memberId: member.id,
        memberIdStr: member.memberId,
        name: member.name,
        shares: memberShares,
        totalContributed: member.totalContributed,
        grossAmount,
        ratePerShare,
      };
    });

    // The exact splitter guarantees the sum matches to the cent.
    const roundingDiffCents = netDistributableCents - payouts.reduce((s, p) => s + p.payoutCents, 0);

    return NextResponse.json({
      success: true,
      data: {
        grossEarnings: formattedGross,
        statutoryReservePercent: formattedReservePercent,
        statutoryReserveAmount,
        netDistributable,
        totalActiveShares,
        ratePerShare,
        reserveFund: reserveFund ? { id: reserveFund.id, name: reserveFund.name } : null,
        distributableFund: { id: distributableFund.id, name: distributableFund.name, balance: distributableFund.balance },
        memberBreakdown,
        roundingAdjustment: (roundingDiffCents / 100).toFixed(2),
        fiscalPeriodId: fiscalPeriodId || null,
        isSimulation: true,
      },
      message: 'Dividend calculation completed (simulation)',
    });
  } catch (err: any) {
    console.error('[DIVIDEND CALCULATE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to calculate dividend' },
      { status: err.statusCode || 500 }
    );
  }
}