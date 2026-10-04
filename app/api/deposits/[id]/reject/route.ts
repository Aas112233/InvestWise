import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

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
    // §6 fail-closed: rejecting mutates another tenant's ledger if the lookup
    // runs unscoped — null tenant must 403.
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
      throw new ValidationError('Only pending deposits can be rejected');
    }

    if (deposit.type !== 'Deposit') {
      throw new ValidationError('Transaction is not a deposit');
    }

    const body = await request.json();
    const { rejectionReason } = body;

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new ValidationError('Rejection reason is required');
    }

    // Fund and member lookups are independent (both keyed off the already
    // fetched deposit row) — batch them into one round-trip group instead of
    // two sequential ones. A deposit without a member can never satisfy the
    // member lookup (sql false → no row); member stays optional as before.
    const [[fund], [member]] = await Promise.all([
      // Fund with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, deposit.fundId!), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      // Member with tenant isolation (§6 hard predicate).
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

    const now = new Date();

    // Update deposit transaction status to REJECTED (§6: tenant-scoped write).
    await db
      .update(transactions)
      .set({
        status: 'REJECTED',
        description: `${deposit.description} - REJECTED: ${rejectionReason.trim()}`,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, scopedTenantId)));

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'REJECT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        memberId: member?.id,
        memberName: member?.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: deposit.amount,
        referenceNumber: deposit.referenceNumber,
        rejectionReason: rejectionReason.trim(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: deposit.referenceNumber,
        status: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
      },
      message: 'Deposit rejected successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSIT REJECT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to reject deposit' },
      { status: err.statusCode || 500 }
    );
  }
}