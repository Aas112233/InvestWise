import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, funds, systemSettings, transactions, profitAllocations, fiscalPeriods } from '@/db/schema/index';
import { eq, and, sql, sum } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import { toCents, fromCents, splitDividendByShares } from '@/lib/money';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check write permission for DIVIDENDS
    if (!hasScreenPermission(user, 'DIVIDENDS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DIVIDENDS');
    }

    const body = await request.json();
    const {
      grossEarnings,
      distributableFundId,
      fiscalPeriodId,
      referenceNumber,
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
    const refNumber = referenceNumber || `DIV-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const db = getDb();

    // Check for duplicate reference number (idempotency)
    const existingDividend = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.referenceNumber, refNumber), eq(transactions.isDeleted, false)))
      .limit(1);

    if (existingDividend.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    // Get system settings for statutory reserve percentage
    const [settings] = await db.select().from(systemSettings).limit(1);
    const statutoryReservePercent = parseFloat(settings?.statutoryReservePercent || '10');

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

    if (!reserveFund) {
      throw new NotFoundError('Reserve fund not found. Please create a RESERVE type fund first.');
    }

    const reserveFundBalance = parseFloat(reserveFund.balance);

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
      throw new ValidationError('No active members with shares found. Dividend cannot be distributed.');
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
    const recipientCount = payouts.filter((p) => p.payoutCents > 0).length;
    // Informational only — actual payouts come from the exact split above.
    const ratePerShare = netDistributableCents / totalActiveShares;

    // Get or create fiscal period
    let fiscalPeriod = null;
    if (fiscalPeriodId) {
      const [fp] = await db
        .select()
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.id, fiscalPeriodId))
        .limit(1);
      fiscalPeriod = fp;
    } else {
      // Create or get current fiscal period
      const currentYear = new Date().getFullYear();
      const [fp] = await db
        .select()
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.year, currentYear), eq(fiscalPeriods.status, 'OPEN')))
        .limit(1);
      if (fp) {
        fiscalPeriod = fp;
      } else {
        // Create new fiscal period
        const [newFp] = await db
          .insert(fiscalPeriods)
          .values({
            year: currentYear,
            periodStart: new Date(`${currentYear}-01-01`),
            periodEnd: new Date(`${currentYear}-12-31`),
            status: 'OPEN',
          })
          .returning();
        fiscalPeriod = newFp;
      }
    }

    const now = new Date();
    let totalDistributedCents = 0;

    // Execute atomic dividend distribution transaction
    await db.transaction(async (tx) => {
      // 1. Debit distributable fund by gross amount
      const newDistributableFundBalance = (fundBalance - gross).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newDistributableFundBalance, updatedAt: now })
        .where(eq(funds.id, distributableFundId));

      // 2. Credit reserve fund with statutory reserve
      const newReserveFundBalance = (reserveFundBalance + parseFloat(statutoryReserveAmount)).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newReserveFundBalance, updatedAt: now })
        .where(eq(funds.id, reserveFund.id));

      // 3. Create statutory reserve transaction
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Statutory Reserve',
        amount: statutoryReserveAmount,
        description: `Statutory reserve (${statutoryReservePercent}%) for dividend run`,
        category: 'Reserve',
        referenceNumber: `${refNumber}-RESERVE`,
        date: now,
        status: 'Completed',
        fundId: reserveFund.id,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: reserveFund.balance,
        balanceAfter: newReserveFundBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });

      // 4. Create dividend distribution transaction for the fund
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Dividend Distribution',
        amount: netDistributable,
        description: `Dividend distribution to ${activeMembers.length} members`,
        category: 'Dividend',
        referenceNumber: `${refNumber}-DIST`,
        date: now,
        status: 'Completed',
        fundId: distributableFundId,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: distributableFund.balance,
        balanceAfter: newDistributableFundBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });

      // 5. Create individual dividend transactions for each member
      for (const member of activeMembers) {
        const memberShares = member.shares;
        const payoutCents = payoutByMember.get(member.id) ?? 0;
        if (payoutCents <= 0) continue; // payout below one whole cent
        const grossAmount = fromCents(payoutCents);
        totalDistributedCents += payoutCents;

        // Credit member's deposit balance (or create payout record)
        // For now, we'll create a dividend transaction record for each member
        await tx.insert(transactions).values({
          tenantId: tenantId || null,
          type: 'Dividend',
          amount: grossAmount,
          description: `Dividend payout for ${memberShares} shares`,
          category: 'Dividend',
          referenceNumber: `${refNumber}-${member.memberId}`,
          date: now,
          status: 'Completed',
          memberId: member.id,
          fundId: distributableFundId,
          handlingOfficer: user.name,
          authorizedBy: user.id,
          balanceBefore: member.totalContributed || '0',
          balanceAfter: (parseFloat(member.totalContributed || '0') + payoutCents / 100).toFixed(2),
          createdBy: user.id,
          updatedBy: user.id,
        });

        // Update member's total contributed (dividend adds to their equity)
        await tx
          .update(members)
          .set({
            totalContributed: (parseFloat(member.totalContributed || '0') + payoutCents / 100).toFixed(2),
            lastActive: now,
            updatedAt: now,
          })
          .where(eq(members.id, member.id));

        // Record in profit_allocations table
        await tx.insert(profitAllocations).values({
          fiscalPeriodId: fiscalPeriod?.id,
          memberId: member.id,
          allocationType: 'Dividend',
          amount: grossAmount,
          sharesAtTime: memberShares,
          ratePerShare: (payoutCents / (memberShares * 100)).toFixed(6),
          notes: `Dividend run ${refNumber}`,
          allocatedBy: user.id,
          allocatedAt: now,
        });
      }

      // 6. Update fiscal period totals
      if (fiscalPeriod) {
        await tx
          .update(fiscalPeriods)
          .set({
            totalEarnings: (parseFloat(fiscalPeriod.totalEarnings || '0') + gross).toFixed(2),
            statutoryReserve: (parseFloat(fiscalPeriod.statutoryReserve || '0') + parseFloat(statutoryReserveAmount)).toFixed(2),
            distributableSurplus: (parseFloat(fiscalPeriod.distributableSurplus || '0') + parseFloat(netDistributable)).toFixed(2),
            actualDistributed: (parseFloat(fiscalPeriod.actualDistributed || '0') + totalDistributedCents / 100).toFixed(2),
            updatedAt: now,
          })
          .where(eq(fiscalPeriods.id, fiscalPeriod.id));
      }
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'DISTRIBUTE_DIVIDEND',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        grossEarnings: formattedGross,
        statutoryReservePercent: statutoryReservePercent.toFixed(2),
        statutoryReserveAmount,
        netDistributable,
        totalActiveShares,
        ratePerShare,
        memberCount: recipientCount,
        distributableFund: { id: distributableFund.id, name: distributableFund.name },
        reserveFund: { id: reserveFund.id, name: reserveFund.name },
        fiscalPeriodId: fiscalPeriod?.id,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        grossEarnings: formattedGross,
        statutoryReservePercent: statutoryReservePercent.toFixed(2),
        statutoryReserveAmount,
        netDistributable,
        totalActiveShares,
        ratePerShare,
        memberCount: recipientCount,
        totalDistributed: (totalDistributedCents / 100).toFixed(2),
        distributableFund: { id: distributableFund.id, name: distributableFund.name, newBalance: (fundBalance - gross).toFixed(2) },
        reserveFund: { id: reserveFund.id, name: reserveFund.name, newBalance: (reserveFundBalance + parseFloat(statutoryReserveAmount)).toFixed(2) },
        fiscalPeriodId: fiscalPeriod?.id,
      },
      message: 'Dividend distribution completed successfully',
    });
  } catch (err: any) {
    console.error('[DIVIDEND DISTRIBUTE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to distribute dividend' },
      { status: err.statusCode || 500 }
    );
  }
}