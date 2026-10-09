import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { toCents } from '@/lib/money';
import { decideReversal, shouldRefundProjectExpenses } from '@/lib/transaction-reversal';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: tenant business data — fail closed without tenant context.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const { id } = await params;
    const db = getDb();

    const [tx] = await db
      .select({
        id: transactions.id,
        referenceNumber: transactions.referenceNumber,
        date: transactions.date,
        type: transactions.type,
        category: transactions.category,
        amount: transactions.amount,
        status: transactions.status,
        description: transactions.description,
        memberId: transactions.memberId,
        memberName: members.name,
        memberCode: members.memberId,
        fundId: transactions.fundId,
        fundName: funds.name,
        projectId: transactions.projectId,
        projectName: projects.title,
        handlingOfficer: transactions.handlingOfficer,
        depositMethod: transactions.depositMethod,
        authorizedBy: transactions.authorizedBy,
        authorizerName: users.name,
        isDeleted: transactions.isDeleted,
        deletedAt: transactions.deletedAt,
        deletionReason: transactions.deletionReason,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      // Related names must resolve only within the same tenant. Legacy or
      // inconsistent foreign keys must not expose another tenant's PII.
      .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, tenantId)))
      .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, tenantId)))
      .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, tenantId)))
      .leftJoin(users, and(eq(transactions.authorizedBy, users.id), eq(users.tenantId, tenantId)))
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .limit(1);

    if (!tx) throw new NotFoundError('Transaction');

    return NextResponse.json({
      success: true,
      data: tx,
    });
  } catch (err: any) {
    console.error('[TRANSACTION GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch transaction' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to soft-delete transactions');
    }

    const { id } = await params;
    // A JSON `null` body parses fine so `.catch()` never fires — normalise to
    // an object before reading fields, or a null body becomes a 500.
    const rawBody = await request.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {} as Record<string, unknown>;
    const reason = body.reason || body.deletionReason;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new ValidationError('A deletion reason is required per financial compliance rules');
    }

    const db = getDb();
    const now = new Date();

    // Serialize every transaction edit with period close. This is deliberately
    // broader than completed rows: a closed period is immutable, and locking
    // here also prevents a pending deposit from being approved concurrently
    // while this deletion is in flight.
    const { existing, softDeleted, reversalApplied } = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
        .limit(1);
      if (!candidate) throw new NotFoundError('Transaction');
      if (!candidate.date) throw new ValidationError('Transaction is missing its date');

      await assertFiscalPeriodOpen(tx, tenantId, candidate.date);

      const [lockedExisting] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
        .for('update')
        .limit(1);
      if (!lockedExisting) throw new NotFoundError('Transaction');
      if (lockedExisting.isDeleted) {
        throw new ValidationError('Transaction is already deleted');
      }

      // Real-money rules — deposits are owned by the revert route; expenses and
      // transfers must have their balance effect reversed here. The decision
      // logic is pure and unit-tested (lib/transaction-reversal.ts).
      const reversal = decideReversal({
        type: lockedExisting.type,
        status: lockedExisting.status,
        fundId: lockedExisting.fundId,
        amount: lockedExisting.amount,
      });

      if (reversal.requiresRevertPath) {
        throw new ValidationError(reversal.revertHint!);
      }

      const reversalFundId = reversal.fundId;
      const reversalDeltaCents = reversal.direction;

      if (reversalFundId && reversalDeltaCents !== 0) {
        const amountCents = toCents(lockedExisting.amount ?? '0');
        if (amountCents > 0) {
          const delta = (reversalDeltaCents * amountCents) / 100;
          // Lock the fund row before mutating so a concurrent expense/transfer
          // cannot lose this reversal (§12 atomic arithmetic, never float).
          await tx
            .select({ id: funds.id })
            .from(funds)
            .where(and(eq(funds.id, reversalFundId), eq(funds.tenantId, tenantId)))
            .for('update')
            .limit(1);
          await tx
            .update(funds)
            .set({
              balance: sql`(${funds.balance}::numeric + ${delta})::numeric(15,2)`,
              updatedAt: now,
            })
            .where(and(eq(funds.id, reversalFundId), eq(funds.tenantId, tenantId)));

          // Expense attributed to a project also inflated projects.totalExpenses
          // — refund that too, else project spend overstates reality forever.
          if (
            shouldRefundProjectExpenses({
              type: lockedExisting.type,
              status: lockedExisting.status,
              fundId: lockedExisting.fundId,
              amount: lockedExisting.amount,
            }) &&
            lockedExisting.projectId
          ) {
            await tx
              .update(projects)
              .set({
                totalExpenses: sql`(coalesce(${projects.totalExpenses}, 0) - ${amountCents / 100})::numeric(15,2)`,
                updatedAt: now,
              })
              .where(and(eq(projects.id, lockedExisting.projectId), eq(projects.tenantId, tenantId)));
          }
        }
      }

      // Rule §12: Soft delete only — transactions use isDeleted + deletedBy/deletionReason, never hard delete.
      const [deleted] = await tx
        .update(transactions)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy: user.id,
          deletionReason: reason.trim(),
          updatedAt: now,
        })
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
        .returning();
      if (!deleted) throw new NotFoundError('Transaction');
      return {
        existing: lockedExisting,
        softDeleted: deleted,
        reversalApplied: reversalDeltaCents !== 0 && toCents(lockedExisting.amount ?? '0') > 0,
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'SOFT_DELETE_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        reason: reason.trim(),
        referenceNumber: existing.referenceNumber,
        type: existing.type,
        amount: existing.amount,
        // Whether the fund (and project) balance effect was reversed as part
        // of this delete — makes the money-integrity behaviour auditable.
        fundId: existing.fundId,
        balanceReversed: reversalApplied,
      },
    });

    return NextResponse.json({
      success: true,
      data: softDeleted,
      balanceReversed: reversalApplied,
      message: reversalApplied
        ? 'Transaction soft-deleted and its fund balance effect reversed'
        : 'Transaction successfully soft-deleted with audit logging',
    });
  } catch (err: any) {
    console.error('[TRANSACTION DELETE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to soft-delete transaction' },
      { status: err.statusCode || 500 }
    );
  }
}
