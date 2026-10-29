import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users, deletedRecords, projectUpdates, fiscalPeriods } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, ne, sql, isNull, gte, lte, aliasedTable } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission, hasAnyScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { LockedError, NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { toCents } from '@/lib/money';
import { decideReversal, shouldRefundProjectExpenses, shouldRefundProjectEarnings } from '@/lib/transaction-reversal';

// A row carries three user references (authorizer, deleter) and two fund
// references (receiving fund, source fund), so each extra join needs its own
// alias or Postgres rejects the query as specifying the same table twice.
const sourceFunds = aliasedTable(funds, 'source_funds');
const deletedUsers = aliasedTable(users, 'deleted_users');

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
        docNumber: transactions.docNumber,
        date: transactions.date,
        type: transactions.type,
        category: transactions.category,
        amount: transactions.amount,
        status: transactions.status,
        description: transactions.description,
        expenseName: transactions.expenseName,
        memberId: transactions.memberId,
        memberName: memberDisplayNameSql,
        memberCode: members.memberId,
        memberEmail: members.email,
        memberUserId: members.userId,
        // The member's contribution balance after this row — the value the
        // payout and arrears engines actually measure.
        memberTotalContributed: members.totalContributed,
        fundId: transactions.fundId,
        fundName: funds.name,
        // Project Investment legs draw capital FROM a deposit fund; a document
        // that shows only the credit side is why treasuries double-count.
        sourceFundId: transactions.sourceFundId,
        sourceFundName: sourceFunds.name,
        projectId: transactions.projectId,
        projectName: projects.title,
        handlingOfficer: transactions.handlingOfficer,
        depositMethod: transactions.depositMethod,
        // The month a deposit is FOR. Distinct from the collected date:
        // back-entry files money under an earlier period.
        depositMonth: transactions.depositMonth,
        balanceBefore: transactions.balanceBefore,
        balanceAfter: transactions.balanceAfter,
        transferGroupId: transactions.transferGroupId,
        authorizedBy: transactions.authorizedBy,
        authorizerName: users.name,
        isDeleted: transactions.isDeleted,
        deletedAt: transactions.deletedAt,
        deletedByName: deletedUsers.name,
        deletionReason: transactions.deletionReason,
        submittedDate: transactions.submittedDate,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      // Related names must resolve only within the same tenant. Legacy or
      // inconsistent foreign keys must not expose another tenant's PII.
      .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, tenantId)))
      .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, tenantId)))
      .leftJoin(
        sourceFunds,
        and(eq(transactions.sourceFundId, sourceFunds.id), eq(sourceFunds.tenantId, tenantId)),
      )
      .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, tenantId)))
      .leftJoin(users, and(eq(transactions.authorizedBy, users.id), eq(users.tenantId, tenantId)))
      .leftJoin(
        deletedUsers,
        and(eq(transactions.deletedBy, deletedUsers.id), eq(deletedUsers.tenantId, tenantId)),
      )
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .limit(1);

    if (!tx) throw new NotFoundError('Transaction');

    // A cancelled document must name the person who cancelled it; a void stamp
    // with no canceller is not an audit trail.
    const { memberUserId, memberEmail, deletedByName, ...txFields } = tx;

    // This route previously had no authorisation floor at all: any
    // authenticated tenant user holding an id could fetch (and therefore print)
    // another member's receipt. Officers pass on screen-read; a plain Member may
    // only reach their own rows.
    const mayReadLedger = hasAnyScreenPermission(user, ['TRANSACTIONS', 'DEPOSITS'], 'READ');
    const isOwnRow =
      Boolean(user.id) &&
      (memberUserId === user.id ||
        (Boolean(memberEmail) && memberEmail?.toLowerCase() === user.email?.toLowerCase()));
    if (!mayReadLedger && !isOwnRow) {
      throw new ForbiddenError('Read permission required for: TRANSACTIONS');
    }

    // Which fiscal period the entry is filed under, and whether that period is
    // closed. A receipt issued into a closed period is a restatement and has to
    // say so on its face.
    const [fiscalPeriod] = tx.date
      ? await db
          .select({
            year: fiscalPeriods.year,
            status: fiscalPeriods.status,
            closedAt: fiscalPeriods.closedAt,
          })
          .from(fiscalPeriods)
          .where(
            and(
              eq(fiscalPeriods.tenantId, tenantId),
              lte(fiscalPeriods.periodStart, tx.date),
              gte(fiscalPeriods.periodEnd, tx.date),
            ),
          )
          .limit(1)
      : [];

    // One fund transfer is two legs sharing transferGroupId. A voucher
    // for one leg would otherwise show money leaving a fund with no stated
    // destination (or arriving from nowhere), so name the counterpart leg —
    // and its reference, so the two halves of one transfer tie together on
    // paper instead of reading as two unrelated movements.
    let transferCounterpart: {
      type: string | null;
      fundName: string | null;
      referenceNumber: string | null;
    } | null = null;
    if (tx.transferGroupId) {
      const [sibling] = await db
        .select({
          type: transactions.type,
          fundName: funds.name,
          referenceNumber: transactions.referenceNumber,
          docNumber: transactions.docNumber,
        })
        .from(transactions)
        .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, tenantId)))
        .where(
          and(
            eq(transactions.transferGroupId, tx.transferGroupId),
            eq(transactions.tenantId, tenantId),
            ne(transactions.id, id),
          ),
        )
        .limit(1);
      if (sibling) transferCounterpart = sibling;
    }

    // Document issuance is itself an auditable act: without it there is no
    // record that a receipt was ever handed out, and a reprint is
    // indistinguishable from the original. Only the print view asks for it.
    if (new URL(request.url).searchParams.get('purpose') === 'print') {
      await logAudit({
        user: { id: user.id, name: user.name },
        tenantId,
        action: 'PRINT_DOCUMENT',
        resourceType: 'Transaction',
        resourceId: id,
        details: {
          referenceNumber: tx.referenceNumber ?? null,
          type: tx.type,
          amount: tx.amount,
          status: tx.status,
          voided: Boolean(tx.isDeleted),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { ...txFields, deletedByName, fiscalPeriod: fiscalPeriod ?? null, transferCounterpart },
    });
  } catch (err: any) {
    console.error('[TRANSACTION GET ERROR]', err);
    return apiError(err, 'Failed to fetch transaction');
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

    // Screen-permission gate, not a bare role check: an explicit READ grant on
    // TRANSACTIONS overrides the role baseline, so the old role-only check let
    // a read-only user delete ledger rows. Write access on the screen is the
    // floor for any destructive ledger edit (Admin/SuperAdmin bypass inside).
    if (!hasScreenPermission(user, 'TRANSACTIONS', 'WRITE')) {
      throw new ForbiddenError('Write access to the transactions screen is required to soft-delete transactions');
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
    const { existing, softDeleted, reversalApplied, siblingLeg } = await db.transaction(async (tx) => {
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

      // A permanently locked (settled) project is an immutable record — its
      // ledger rows cannot be reversed out from under it.
      if (lockedExisting.projectId) {
        const [hostProject] = await tx
          .select({ isLocked: projects.isLocked })
          .from(projects)
          .where(and(eq(projects.id, lockedExisting.projectId), eq(projects.tenantId, tenantId)))
          .limit(1);
        if (hostProject?.isLocked) {
          throw new LockedError(
            'This transaction belongs to a completed, permanently locked project — it cannot be deleted.',
          );
        }
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

      // Single fund-balance adjustment used for both the deleted leg and its
      // paired transfer leg below: row lock + integer-cents arithmetic in SQL
      // (§12 atomic arithmetic, never float). deltaCents is signed.
      const applyFundDeltaCents = async (fundId: string, deltaCents: number) => {
        await tx
          .select({ id: funds.id })
          .from(funds)
          .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
          .for('update')
          .limit(1);
        await tx
          .update(funds)
          .set({
            balance: sql`(${funds.balance}::numeric + ${deltaCents / 100})::numeric(15,2)`,
            updatedAt: now,
          })
          .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)));
      };

      const reversalFundId = reversal.fundId;
      const reversalDeltaCents = reversal.direction;

      if (reversalFundId && reversalDeltaCents !== 0) {
        const amountCents = toCents(lockedExisting.amount ?? '0');
        if (amountCents > 0) {
          // Lock the fund row before mutating so a concurrent expense/transfer
          // cannot lose this reversal (§12 atomic arithmetic, never float).
          await applyFundDeltaCents(reversalFundId, reversalDeltaCents * amountCents);

          // Expense attributed to a project also inflated projects.totalExpenses
          // and debited projects.currentFundBalance (see addExpense) — refund
          // both, else the project's spend and live balance drift forever.
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
                currentFundBalance: sql`(coalesce(${projects.currentFundBalance}, 0) + ${amountCents / 100})::numeric(15,2)`,
                updatedAt: now,
              })
              .where(and(eq(projects.id, lockedExisting.projectId), eq(projects.tenantId, tenantId)));
          }

          // #108b: symmetric refund — a settled Earning attributed to a project
          // inflated projects.totalEarnings and credited
          // projects.currentFundBalance (see addEarning); deleting it must
          // decrement both or the project overstates revenue and balance.
          if (
            shouldRefundProjectEarnings({
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
                totalEarnings: sql`(coalesce(${projects.totalEarnings}, 0) - ${amountCents / 100})::numeric(15,2)`,
                currentFundBalance: sql`(coalesce(${projects.currentFundBalance}, 0) - ${amountCents / 100})::numeric(15,2)`,
                updatedAt: now,
              })
              .where(and(eq(projects.id, lockedExisting.projectId), eq(projects.tenantId, tenantId)));
          }
        }
      }

      // Transfer atomicity: one fund transfer posts TWO legs (Transfer Out +
      // Transfer In) linked by transferGroupId. Reversing only the deleted leg
      // strands the sibling's movement — e.g. deleting Transfer In debits the
      // destination back while the source stays debited, and the money
      // vanishes from both funds. So deleting a settled transfer leg voids the
      // whole transfer: the live sibling is reversed and soft-deleted
      // atomically here, restoring both funds. Legs without a group id
      // predate the link and keep the legacy per-leg behaviour.
      let siblingLeg: { id: string; type: string | null; reversed: boolean } | null = null;
      const isSettledTransferLeg =
        (lockedExisting.type === 'Transfer In' || lockedExisting.type === 'Transfer Out') &&
        reversalDeltaCents !== 0;
      if (isSettledTransferLeg && lockedExisting.transferGroupId) {
        const [sibling] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.transferGroupId, lockedExisting.transferGroupId),
              eq(transactions.tenantId, tenantId),
              ne(transactions.id, id),
              eq(transactions.isDeleted, false),
            ),
          )
          .for('update')
          .limit(1);
        if (sibling) {
          if (!sibling.date) throw new ValidationError('Paired transfer leg is missing its date');
          await assertFiscalPeriodOpen(tx, tenantId, sibling.date);
          const siblingReversal = decideReversal({
            type: sibling.type,
            status: sibling.status,
            fundId: sibling.fundId,
            amount: sibling.amount,
          });
          if (siblingReversal.requiresRevertPath) {
            throw new ValidationError(siblingReversal.revertHint!);
          }
          const siblingAmountCents = toCents(sibling.amount ?? '0');
          let siblingReversed = false;
          if (siblingReversal.fundId && siblingReversal.direction !== 0 && siblingAmountCents > 0) {
            await applyFundDeltaCents(siblingReversal.fundId, siblingReversal.direction * siblingAmountCents);
            siblingReversed = true;
          }
          await tx
            .update(transactions)
            .set({
              isDeleted: true,
              deletedAt: now,
              deletedBy: user.id,
              deletionReason: `Paired leg of deleted transfer ${lockedExisting.referenceNumber ?? lockedExisting.id}: ${reason.trim()}`,
              updatedAt: now,
            })
            .where(and(eq(transactions.id, sibling.id), eq(transactions.tenantId, tenantId)));
          siblingLeg = { id: sibling.id, type: sibling.type, reversed: siblingReversed };
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

      // Immutable archive (§12): the soft-delete modal promises the row is
      // "never permanently expunged". The finance service path already writes
      // this archive; without it here, everything deleted through the live
      // client path left no forensic copy. Archive the primary row and any
      // paired transfer leg voided above.
      const archiveRows: Array<typeof transactions.$inferSelect> = [deleted];
      if (siblingLeg) {
        const [siblingRow] = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.id, siblingLeg.id), eq(transactions.tenantId, tenantId)))
          .limit(1);
        if (siblingRow) archiveRows.push(siblingRow);
      }
      await tx.insert(deletedRecords).values(
        archiveRows.map((row) => ({
          originalId: row.id,
          collectionName: 'Transaction',
          data: row as unknown as Record<string, unknown>,
          reason: row.deletionReason ?? reason.trim(),
          deletedBy: user.id,
          deletedAt: now,
        })),
      );

      // Mirror the soft-delete onto the project_updates row that backs the
      // "Financial Updates" tab, so a deleted project posting doesn't linger
      // there. The two rows are always written with the same (project, type,
      // amount, date, balance_after); there is no explicit link between them.
      if (lockedExisting.projectId && lockedExisting.date) {
        const puBalanceMatch =
          lockedExisting.balanceAfter == null
            ? isNull(projectUpdates.balanceAfter)
            : eq(projectUpdates.balanceAfter, lockedExisting.balanceAfter);
        await tx
          .update(projectUpdates)
          .set({ isDeleted: true })
          .where(
            and(
              eq(projectUpdates.projectId, lockedExisting.projectId),
              eq(projectUpdates.tenantId, tenantId),
              eq(projectUpdates.type, lockedExisting.type),
              eq(projectUpdates.amount, lockedExisting.amount),
              eq(projectUpdates.date, lockedExisting.date),
              puBalanceMatch,
            ),
          );
      }

      return {
        existing: lockedExisting,
        softDeleted: deleted,
        reversalApplied: reversalDeltaCents !== 0 && toCents(lockedExisting.amount ?? '0') > 0,
        siblingLeg,
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
        // Paired transfer leg voided alongside this delete, if any.
        siblingLegId: siblingLeg?.id ?? null,
        siblingLegType: siblingLeg?.type ?? null,
        siblingBalanceReversed: siblingLeg?.reversed ?? false,
      },
    });

    return NextResponse.json({
      success: true,
      data: softDeleted,
      balanceReversed: reversalApplied,
      siblingLegReversed: siblingLeg?.reversed ?? false,
      message: siblingLeg
        ? 'Transfer leg soft-deleted; paired leg reversed too — both funds restored'
        : reversalApplied
          ? 'Transaction soft-deleted and its fund balance effect reversed'
          : 'Transaction successfully soft-deleted with audit logging',
    });

  } catch (err: any) {
    console.error('[TRANSACTION DELETE ERROR]', err);
    return apiError(err, 'Failed to soft-delete transaction');
  }
}
