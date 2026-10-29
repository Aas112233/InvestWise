import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, projectUpdates } from '@/db/schema/index';
import { eq, and, ne, sql, isNull } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { LockedError, NotFoundError, ValidationError, ForbiddenError, readJsonBody } from '@/lib/utils/errors';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { toCents } from '@/lib/money';
import { decideReversal, shouldRefundProjectExpenses, shouldRefundProjectEarnings } from '@/lib/transaction-reversal';
import { apiError } from '@/lib/utils/api-error';

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type TransactionRow = typeof transactions.$inferSelect;

/**
 * Re-apply one soft-deleted row's money effect and clear its soft-delete flag.
 *
 * A soft delete is not a flag flip: the DELETE path reversed the transaction's
 * effect (fund balance + project rollups) so the ledger stayed balanced.
 * Restoring therefore applies the exact INVERSE of that reversal, derived from
 * the same canonical classifier the delete used, so the two can never drift
 * (§12). Member totals are recomputed from the ledger rather than guessed.
 */
async function restoreRow(
  tx: DbTransaction,
  row: TransactionRow,
  tenantId: string,
  userId: string,
  now: Date,
): Promise<TransactionRow> {
  if (!row.date) throw new ValidationError('Transaction is missing its date');
  // A restore re-posts money into the ledger, so the period must be open.
  await assertFiscalPeriodOpen(tx, tenantId, row.date);

  const amountCents = toCents(row.amount ?? '0');
  const reversal = decideReversal({
    type: row.type,
    status: row.status,
    fundId: row.fundId,
    amount: row.amount,
  });
  if (reversal.requiresRevertPath) {
    // A settled deposit is never soft-deleted (the delete path refuses), so
    // reaching this means the row was mutated out-of-band.
    throw new ValidationError(
      'This transaction must be restored through the deposit approval path, not the recovery desk',
    );
  }

  if (reversal.fundId && reversal.direction !== 0 && amountCents > 0) {
    const restoreDeltaCents = -reversal.direction * amountCents;
    const [fund] = await tx
      .select()
      .from(funds)
      .where(and(eq(funds.id, reversal.fundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (fund) {
      if (restoreDeltaCents < 0) {
        const afterCents = toCents(fund.balance ?? '0') + restoreDeltaCents;
        if (afterCents < toCents(fund.minimumBalance ?? '0')) {
          throw new ValidationError(
            `Cannot restore: re-applying ${(amountCents / 100).toFixed(2)} would drop ${fund.name} below its minimum reserve`,
          );
        }
      }
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${restoreDeltaCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, reversal.fundId), eq(funds.tenantId, tenantId)));
    }

    // Inverse of the project rollup refunds the delete applied.
    if (row.projectId) {
      const refundsExpense = shouldRefundProjectExpenses({
        type: row.type,
        status: row.status,
        fundId: row.fundId,
        amount: row.amount,
      });
      const refundsEarning = shouldRefundProjectEarnings({
        type: row.type,
        status: row.status,
        fundId: row.fundId,
        amount: row.amount,
      });
      if (refundsExpense || refundsEarning) {
        await tx
          .update(projects)
          .set({
            ...(refundsExpense
              ? {
                  totalExpenses: sql`(coalesce(${projects.totalExpenses}, 0) + ${amountCents / 100})::numeric(15,2)`,
                  currentFundBalance: sql`(coalesce(${projects.currentFundBalance}, 0) - ${amountCents / 100})::numeric(15,2)`,
                }
              : {}),
            ...(refundsEarning
              ? {
                  totalEarnings: sql`(coalesce(${projects.totalEarnings}, 0) + ${amountCents / 100})::numeric(15,2)`,
                  currentFundBalance: sql`(coalesce(${projects.currentFundBalance}, 0) + ${amountCents / 100})::numeric(15,2)`,
                }
              : {}),
            updatedAt: now,
          })
          .where(and(eq(projects.id, row.projectId), eq(projects.tenantId, tenantId)));
      }
    }
  }

  // Recompute the member's derived totals from the ledger rather than guessing
  // a delta — idempotent and immune to any prior drift.
  if (row.memberId && row.type === 'Deposit') {
    const result = (await tx.execute(
      sql`SELECT COALESCE(SUM(amount::numeric), 0) as total,
                 MAX(COALESCE(deposit_month, to_char(date AT TIME ZONE 'UTC', 'YYYY-MM'))) as last_month
          FROM transactions
          WHERE member_id = ${row.memberId}
            AND tenant_id = ${tenantId}
            AND type = 'Deposit'
            AND status IN ('Completed', 'Success')
            AND is_deleted = false`,
    )) as unknown as Array<{ total: string; last_month: string | null }>;
    const totalCents = toCents(result[0]?.total ?? '0');
    await tx
      .update(members)
      .set({
        totalContributed: sql`${(totalCents / 100).toFixed(2)}::numeric(15,2)`,
        lastDepositMonth: result[0]?.last_month ?? null,
        updatedAt: now,
      })
      .where(and(eq(members.id, row.memberId), eq(members.tenantId, tenantId)));
  }

  const [updated] = await tx
    .update(transactions)
    .set({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deletionReason: null,
      updatedBy: userId,
      updatedAt: now,
    })
    .where(and(eq(transactions.id, row.id), eq(transactions.tenantId, tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Transaction');
  return updated;
}

/**
 * Restore (undelete) a soft-deleted transaction.
 *
 * Admin/SuperAdmin only, tenant-scoped (§6). Deleting a settled transfer leg
 * voids BOTH legs atomically (the sibling is soft-deleted with it) so the two
 * funds stay balanced — restore is symmetric: restoring one leg restores its
 * paired sibling too, or the pair would be left half-applied.
 */
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

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to restore transactions');
    }

    const { id } = await params;
    const body = await readJsonBody(request).catch(() => ({}) as Record<string, unknown>);
    const rawReason = (body as Record<string, unknown>).reason;
    const reason =
      typeof rawReason === 'string' && rawReason.trim().length > 0
        ? rawReason.trim()
        : 'Restored by administrator';

    const db = getDb();
    const now = new Date();

    const { restored, siblingRestored } = await db.transaction(async (tx) => {
      // Lock the row so a concurrent restore cannot re-apply the balance twice.
      const [row] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundError('Transaction');
      if (!row.isDeleted) throw new ValidationError('Transaction is not deleted');

      // A permanently locked (settled) project is an immutable record — none
      // of its soft-deleted rows can come back to life.
      if (row.projectId) {
        const [hostProject] = await tx
          .select({ isLocked: projects.isLocked })
          .from(projects)
          .where(and(eq(projects.id, row.projectId), eq(projects.tenantId, scopedTenantId)))
          .limit(1);
        if (hostProject?.isLocked) {
          throw new LockedError(
            'This transaction belongs to a completed, permanently locked project — it cannot be restored.',
          );
        }
      }

      const primary = await restoreRow(tx, row, scopedTenantId, user.id, now);

      // Mirror the restore onto the project_updates row (inverse of the
      // delete-time mirror) so the "Financial Updates" tab shows it again.
      // Transfer legs have no project_updates row, so the projectId guard is
      // a no-op for them.
      if (row.projectId && row.date) {
        const puBalanceMatch =
          row.balanceAfter == null
            ? isNull(projectUpdates.balanceAfter)
            : eq(projectUpdates.balanceAfter, row.balanceAfter);
        await tx
          .update(projectUpdates)
          .set({ isDeleted: false })
          .where(
            and(
              eq(projectUpdates.projectId, row.projectId),
              eq(projectUpdates.tenantId, scopedTenantId),
              eq(projectUpdates.type, row.type),
              eq(projectUpdates.amount, row.amount),
              eq(projectUpdates.date, row.date),
              puBalanceMatch,
            ),
          );
      }

      // Symmetric transfer restore: bring back the paired leg the delete
      // voided alongside this one, if it is still deleted.
      let sibling: TransactionRow | null = null;
      if (
        (row.type === 'Transfer In' || row.type === 'Transfer Out') &&
        row.transferGroupId
      ) {
        const [siblingRow] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.transferGroupId, row.transferGroupId),
              eq(transactions.tenantId, scopedTenantId),
              ne(transactions.id, row.id),
              eq(transactions.isDeleted, true),
            ),
          )
          .for('update')
          .limit(1);
        if (siblingRow) sibling = await restoreRow(tx, siblingRow, scopedTenantId, user.id, now);
      }

      return { restored: primary, siblingRestored: sibling };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: scopedTenantId,
      action: 'RESTORE_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        referenceNumber: restored.referenceNumber,
        type: restored.type,
        amount: restored.amount,
        reason,
        siblingLegId: siblingRestored?.id ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      data: restored,
      siblingLegRestored: siblingRestored?.id ?? null,
      message: 'Transaction restored and its balance effect re-applied',
    });
  } catch (err: any) {
    console.error('[RESTORE TRANSACTION ERROR]', err);
    return apiError(err, 'Failed to restore transaction');
  }
}
