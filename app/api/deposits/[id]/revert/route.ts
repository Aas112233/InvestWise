import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';

// POST /api/deposits/[id]/revert — Completed -> PENDING with amount reversal.
// Request-origin deposits cannot be deleted; they revert instead. Per confirmed
// spec, ALL Completed deposits are blocked from delete and must revert first.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);

    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || body.revertReason;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new ValidationError("[Field 'reason', Code: required] A revert reason is required per financial compliance rules");
    }

    const db = getDb();
    const [deposit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false), eq(transactions.tenantId, scopedTenantId)))
      .limit(1);

    if (!deposit) {
      throw new NotFoundError('Deposit transaction');
    }
    if (deposit.type !== 'Deposit') {
      throw new ValidationError('Transaction is not a deposit');
    }
    if (deposit.status !== 'Completed' && deposit.status !== 'Success') {
      throw new ValidationError('Only completed deposits can be reverted to request');
    }
    if (!deposit.fundId || !deposit.memberId) {
      throw new ValidationError('Deposit is missing fund or member linkage');
    }

    const txnCents = toCents(deposit.amount);

    const [[fund], [member]] = await Promise.all([
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, deposit.fundId!), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      db
        .select()
        .from(members)
        .where(and(eq(members.id, deposit.memberId!), eq(members.tenantId, scopedTenantId)))
        .limit(1),
    ]);

    if (!fund) {
      throw new NotFoundError('Fund');
    }
    if (!member) {
      throw new NotFoundError('Member');
    }

    const afterCents = toCents(fund.balance ?? '0') - txnCents;
    const minReserveCents = toCents(fund.minimumBalance ?? '0');
    if (afterCents < minReserveCents) {
      throw new ValidationError(
        `Cannot revert: reversing ${fromCents(txnCents)} would drop ${fund.name} below minimum reserve`,
      );
    }

    const now = new Date();

    // Bulletproofing (Funds module spec): the fund and member rows are locked
    // (FOR UPDATE, sorted order to avoid deadlocks) and re-read INSIDE the tx,
    // and balance writes are atomic SQL arithmetic — a concurrent deposit,
    // transfer, or expense can never lose an update. The outer unlocked read
    // only serves the pre-checks above. All math in integer cents (§12).
    const { newFundBalance, newMemberContributed } = await db.transaction(async (tx) => {
      const [lockedFund] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, deposit.fundId!), eq(funds.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      const [lockedMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, deposit.memberId!), eq(members.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedFund) throw new NotFoundError('Fund');
      if (!lockedMember) throw new NotFoundError('Member');

      const fundBalanceCents = toCents(lockedFund.balance ?? '0');
      const afterCentsLocked = fundBalanceCents - txnCents;
      const minReserveCents = toCents(lockedFund.minimumBalance ?? '0');
      if (afterCentsLocked < minReserveCents) {
        throw new ValidationError(
          `Cannot revert: reversing ${fromCents(txnCents)} would drop ${lockedFund.name} below minimum reserve`,
        );
      }
      const memberAfterCents = Math.max(0, toCents(lockedMember.totalContributed ?? '0') - txnCents);

      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric - ${txnCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, deposit.fundId!), eq(funds.tenantId, scopedTenantId)));

      await tx
        .update(members)
        .set({
          totalContributed: sql`GREATEST((${members.totalContributed}::numeric - ${txnCents / 100})::numeric(15,2), 0)`,
          updatedAt: now,
        })
        .where(and(eq(members.id, deposit.memberId!), eq(members.tenantId, scopedTenantId)));

      await tx
        .update(transactions)
        .set({
          status: 'PENDING',
          description: `${deposit.description} — REVERTED: ${reason.trim()}`,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, scopedTenantId)));

      // §12 accuracy: a reverted month must not leave the member looking
      // paid-up. Recompute last_deposit_month from the member's remaining
      // COMPLETED deposits — stored deposit_month first, collected-date month
      // as fallback. The reverted row is already PENDING (updated above,
      // visible within this tx), so the status filter excludes it. MAX over
      // 'YYYY-MM' strings is chronological; NULL clears paid-up status when
      // nothing remains.
      await tx.execute(sql`
        UPDATE ${members}
        SET last_deposit_month = (
          SELECT MAX(COALESCE(t.deposit_month, to_char(t.date AT TIME ZONE 'UTC', 'YYYY-MM')))
          FROM ${transactions} t
          WHERE t.member_id = ${deposit.memberId}::uuid
            AND t.tenant_id = ${scopedTenantId}::uuid
            AND t.type = 'Deposit'
            AND t.is_deleted = false
            AND t.status IN ('Completed', 'Success')
        ),
        updated_at = ${now}
        WHERE ${members.id} = ${deposit.memberId}::uuid
          AND ${members.tenantId} = ${scopedTenantId}::uuid
      `);

      return {
        newFundBalance: fromCents(afterCentsLocked),
        newMemberContributed: fromCents(memberAfterCents),
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'REVERT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: fromCents(txnCents),
        referenceNumber: deposit.referenceNumber,
        previousStatus: deposit.status,
        newStatus: 'PENDING',
        reason: reason.trim(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: deposit.referenceNumber,
        status: 'PENDING',
        amount: fromCents(txnCents),
        fund: { id: fund.id, name: fund.name, newBalance: newFundBalance },
        member: { id: member.id, name: member.name, newTotalContributed: newMemberContributed },
      },
      message: 'Deposit reverted to request successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSIT REVERT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to revert deposit' },
      { status: err.statusCode || 500 },
    );
  }
}
