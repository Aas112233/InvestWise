import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';
import { isSuperAdminRole, normalizeRole } from '@/lib/roles';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { findDepositMonthOccupant, depositMonthConflictMessage } from '@/lib/deposit-month-limit';
import { loadMemberDepositSchedule } from '@/lib/deposit-schedule/lookup';
import { assertMemberNotSuspended } from '@/lib/member-display';
import { DEPOSIT_CATEGORY } from '@/lib/deposit-fund';
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

    // Segregation of duties: a non-admin requester can never approve their
    // own deposit request. Admins and platform operators are exempt — the
    // tenant admin is the fund officer in single-officer organizations, and
    // the direct deposit path (finance.approveDeposit via PUT
    // /api/finance/deposits/[id]) has always allowed self-approval for any
    // DEPOSITS-WRITE user, so guarding only the request path would just push
    // admins through the other door. Staff approvers (Manager/Member with
    // granted DEPOSITS write) stay guarded. The full row is selected above,
    // so createdBy is present; the guard only skips genuinely NULL (legacy
    // pre-createdBy) rows — it never fires for a different approver.
    const isAdminApprover =
      isSuperAdminRole(user.role) || normalizeRole(user.role) === 'Admin';
    if (!isAdminApprover && deposit.createdBy && deposit.createdBy === user.id) {
      throw new ValidationError("[Field 'createdBy', Code: SELF_APPROVAL] You cannot approve your own deposit request. Ask another officer with Deposits write access to approve it.");
    }

    const body = await readJsonBody(request);

    // Share numbers are one-time setup (member creation). Approvals never
    // change them — a non-zero payload is rejected, not silently applied.
    if (Number(body.shares ?? 0) !== 0) {
      throw new ValidationError('Share numbers are locked after member creation and cannot be changed by deposits. Adjust shares by editing the member in the Members screen.');
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
    // A request created while the member was active can outlive their
    // suspension — approving must not credit money to a suspended member.
    assertMemberNotSuspended(member, 'approving a deposit');

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
      await assertFiscalPeriodOpen(tx, scopedTenantId, collectedDate);
      // Re-check under the fiscal lock and transaction-row lock. Concurrent
      // approvals must not credit the same pending request twice.
      const [lockedDeposit] = await tx
        .select({ status: transactions.status, type: transactions.type, isDeleted: transactions.isDeleted })
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedDeposit || lockedDeposit.isDeleted) throw new NotFoundError('Deposit transaction');
      if (lockedDeposit.type !== 'Deposit') throw new ValidationError('Transaction is not a deposit');
      if (lockedDeposit.status !== 'PENDING') throw new ValidationError('Only pending deposits can be approved');

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
      // Re-assert on the locked row (race: suspension between outer read and tx).
      assertMemberNotSuspended(lockedMember, 'approving a deposit');

      // Resolved INSIDE the tx, on the locked member row, so a schedule switched
      // between the request being filed and it being approved cannot slip a
      // double-credit through a stale outer read.
      const depositSchedule = await loadMemberDepositSchedule(tx, {
        tenantId: scopedTenantId,
        memberId: sourceMemberId,
      });

      // §12 one-deposit-per-month (MONTHLY only): the final gate. Approval credits
      // settled money, so the member's month must be free of any OTHER occupant —
      // the request being approved is excluded, but a settled deposit or a second
      // pending request for the same month (legacy duplicates) blocks the approval.
      // A reverted deposit re-approves cleanly: it excludes itself and a reverted
      // direct row never occupies its month. Under a flexible schedule the guard
      // returns null without querying.
      const monthOccupant = await findDepositMonthOccupant(tx, {
        tenantId: scopedTenantId,
        memberId: sourceMemberId,
        depositMonthKey,
        excludeId: id,
        enforced: depositSchedule.enforced,
      });
      if (monthOccupant) {
        throw new ValidationError(depositMonthConflictMessage(depositMonthKey, monthOccupant));
      }

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
          // Approval used to flip only the status, so a settled deposit kept the
          // 'Deposit Request' label it was filed with, permanently. Two things
          // read that label: the report's Category column, and the
          // pending-request rules (GET /api/deposits excludes
          // status='PENDING' AND category='Deposit Request'; the finance service
          // releases a month once category === 'Deposit'). Settled money has to
          // read as a deposit from the moment it settles.
          category: DEPOSIT_CATEGORY,
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
      tenantId: scopedTenantId,
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
      // Zero extra queries: `deposit` is the row this handler already fetched
      // (§6 tenant lookup); the after-state comes from the transaction's
      // computed balances (its return value) plus the row's own
      // balanceBefore, recorded when the request was made.
      before: deposit,
      after: {
        status: 'Completed',
        balanceBefore: deposit.balanceBefore,
        balanceAfter: newFundBalance,
        memberTotalContributed: newMemberContributed,
        authorizedBy: user.id,
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
    return apiError(err, 'Failed to approve deposit');
  }
}