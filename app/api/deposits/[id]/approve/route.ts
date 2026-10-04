import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';
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
    // §6 fail-closed: approving moves money — null tenant must 403 so the
    // pending-deposit lookup below can never match another tenant's row.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check write permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const { id } = await params;
    const db = getDb();

    // Get the pending deposit transaction (§6 hard tenant predicate).
    const [deposit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId)))
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

    // Fund and member lookups are independent (both keyed off the already
    // fetched deposit row) — batch them into one round-trip group instead of
    // two sequential ones. Error checks below preserve the original
    // precedence (missing fund → missing member).
    const [[fund], [member]] = await Promise.all([
      // Fund with tenant isolation (§6 hard predicate — the fund must belong
      // to the same tenant as the deposit, not just any tenant).
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, deposit.fundId!), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      // Member with tenant isolation (§6 hard predicate). A deposit without
      // a member can never satisfy the lookup (sql false → no row).
      db
        .select()
        .from(members)
        .where(
          deposit.memberId
            ? and(eq(members.id, deposit.memberId), eq(members.tenantId, scopedTenantId))
            : sql`false`
        )
        .limit(1),
    ]);

    if (!fund) {
      throw new NotFoundError('Fund');
    }

    if (!member) {
      throw new NotFoundError('Member');
    }

    const amountCents = toCents(deposit.amount);
    const formattedAmount = fromCents(amountCents);
    const now = new Date();
    // Deposit month: the explicitly selected month stored on the row wins —
    // it survives a revert→re-approve cycle where the collected date no
    // longer reflects the intended month. Collected date stays the fallback
    // for rows created before the column existed.
    const collectedDate = deposit.date ? new Date(deposit.date) : now;
    const depositMonthKey = deposit.depositMonth || collectedDate.toISOString().slice(0, 7);

    // Execute atomic approval transaction (§6: every write re-asserts the
    // tenant — id-only updates would let a row fetched under one tenant be
    // mutated via a cross-tenant id). Bulletproofing (Funds module spec):
    // fund/member rows are locked (FOR UPDATE, sorted order) and re-read
    // INSIDE the tx; balance writes are atomic SQL arithmetic so concurrent
    // movements can never lose an update. All math in integer cents (§12).
    const { newFundBalance, newMemberContributed } = await db.transaction(async (tx) => {
      const sourceFundId = deposit.fundId!;
      const sourceMemberId = deposit.memberId!;
      const [lockedFund] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, sourceFundId), eq(funds.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      const [lockedMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, sourceMemberId), eq(members.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedFund) throw new NotFoundError('Fund');
      if (!lockedMember) throw new NotFoundError('Member');

      const fundBalanceCents = toCents(lockedFund.balance ?? '0');
      const memberContributedCents = toCents(lockedMember.totalContributed ?? '0');
      const newFundBalanceCents = fundBalanceCents + amountCents;
      const newMemberContributedCents = memberContributedCents + amountCents;

      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, sourceFundId), eq(funds.tenantId, scopedTenantId)));

      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${amountCents / 100})::numeric(15,2)`,
          // GREATEST: approving an old month's deposit must never roll the
          // member's paid-up status backward. YYYY-MM strings compare
          // chronologically; '' (never deposited) loses to any month.
          lastDepositMonth: sql`GREATEST(COALESCE(${members.lastDepositMonth}, ''), ${depositMonthKey})`,
          lastActive: now,
          updatedAt: now,
        })
        .where(and(eq(members.id, sourceMemberId), eq(members.tenantId, scopedTenantId)));

      // Update deposit transaction status
      await tx
        .update(transactions)
        .set({
          status: 'Completed',
          balanceBefore: fromCents(fundBalanceCents),
          balanceAfter: fromCents(newFundBalanceCents),
          authorizedBy: user.id,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, scopedTenantId)));

      return {
        newFundBalance: fromCents(newFundBalanceCents),
        newMemberContributed: fromCents(newMemberContributedCents),
      };
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
        member: { id: member.id, name: member.name, newTotalContributed: newMemberContributed, shares: member.shares },
        fund: { id: fund.id, name: fund.name, newBalance: newFundBalance },
        amount: formattedAmount,
        status: 'COMPLETED',
        date: collectedDate.toISOString(),
        depositMonth: depositMonthKey,
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