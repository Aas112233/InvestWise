import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check write permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const { id } = await params;
    const db = getDb();

    // Get the pending deposit transaction
    const [deposit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false), tenantId ? eq(transactions.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!deposit) {
      throw new NotFoundError('Deposit transaction');
    }

    if (deposit.status !== 'PENDING') {
      throw new ValidationError('Only pending deposits can be approved');
    }

    if (deposit.type !== 'Deposit') {
      throw new ValidationError('Transaction is not a deposit');
    }

    const body = await request.json();

    // Share numbers are one-time setup (member creation). Approvals never
    // change them — a non-zero payload is rejected, not silently applied.
    if (Number(body.shares ?? 0) !== 0) {
      throw new ValidationError('Share numbers are locked after member creation and cannot be changed by deposits');
    }

    // Get fund with tenant isolation
    const [fund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, deposit.fundId!), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!fund) {
      throw new NotFoundError('Fund');
    }

    // Get member with tenant isolation
    let member = null;
    if (deposit.memberId) {
      const [m] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, deposit.memberId), tenantId ? eq(members.tenantId, tenantId) : sql`true`))
        .limit(1);
      member = m;
    }

    if (!member) {
      throw new NotFoundError('Member');
    }

    const depositAmount = parseFloat(deposit.amount);
    const formattedAmount = depositAmount.toFixed(2);
    const now = new Date();

    // Execute atomic approval transaction
    await db.transaction(async (tx) => {
      // Update fund balance
      const fundBalance = parseFloat(fund.balance);
      const newFundBalance = (fundBalance + depositAmount).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newFundBalance, updatedAt: now })
        .where(eq(funds.id, deposit.fundId!));

      // Update member contributions
      const memberContributed = parseFloat(member.totalContributed || '0');
      const newMemberContributed = (memberContributed + depositAmount).toFixed(2);

      await tx
        .update(members)
        .set({ 
          totalContributed: newMemberContributed,
          lastDepositMonth: now.toISOString().slice(0, 7),
          lastActive: now,
          updatedAt: now,
        })
        .where(eq(members.id, deposit.memberId!));

      // Update deposit transaction status
      await tx
        .update(transactions)
        .set({
          status: 'Completed',
          balanceBefore: fund.balance,
          balanceAfter: newFundBalance,
          authorizedBy: user.id,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(transactions.id, id));
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'APPROVE_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: formattedAmount,
        referenceNumber: deposit.referenceNumber,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: deposit.referenceNumber,
        member: { id: member.id, name: member.name, newTotalContributed: (parseFloat(member.totalContributed || '0') + depositAmount).toFixed(2), shares: member.shares },
        fund: { id: fund.id, name: fund.name, newBalance: (parseFloat(fund.balance) + depositAmount).toFixed(2) },
        amount: formattedAmount,
        status: 'COMPLETED',
        date: now.toISOString(),
      },
      message: 'Deposit approved successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSIT APPROVE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to approve deposit' },
      { status: err.statusCode || 500 }
    );
  }
}