import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates, projectMembers, funds, transactions, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { LockedError, NotFoundError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { disbursementSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from '../../_helpers';
import { parsePositiveAmount, toCents, fromCents } from '@/lib/money';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import crypto from 'node:crypto';

// Money routes span several round-trips in one transaction — keep headroom
// over the 10s serverless default.
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // §6/RBAC: disbursements move project money — Manager/Admin/SuperAdmin only.
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const body = await readJsonBody(request);
    const parsed = disbursementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: zodMessage(parsed.error) },
        { status: 400 },
      );
    }
    const { type, description } = parsed.data;
    let amountCents: number;
    try {
      // Project postings outscale member-level deposits (budgets are unbounded
      // up to decimal(15,2)), so the ceiling here is 999,999,999.99 rather
      // than the codebase-wide 10M member-transaction default.
      amountCents = parsePositiveAmount(parsed.data.amount, { field: 'amount', maxCents: 99_999_999_999 });
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Invalid amount');
    }

    // #107: posting date. Defaults to now (legacy clients). A client-supplied
    // date may be backdated (the fiscal-period guard below validates its
    // period), but never future-dated beyond clock-skew slack — future rows
    // would poison balance snapshots and period totals.
    const receivedAt = new Date();
    let postingDate = receivedAt;
    if (parsed.data.date) {
      const d = new Date(parsed.data.date);
      if (Number.isNaN(d.getTime())) {
        throw new ValidationError('date must be a valid ISO date/datetime');
      }
      if (d.getTime() > receivedAt.getTime() + 12 * 60 * 60 * 1000) {
        throw new ValidationError('date cannot be in the future');
      }
      postingDate = d;
    }

    // #107: optional "handled by" project associate member. Name entry only —
    // the member is recorded on the ledger row (handlingOfficer + memberId)
    // but no balance anywhere moves for them: member equity derives from
    // Deposit/Dividend rows, and this writes Earning/Expense.
    let handledBy: { id: string; name: string } | null = null;
    if (parsed.data.handledByMemberId) {
      const db0 = getDb();
      const [memberRow] = await db0
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(
          and(
            eq(members.id, parsed.data.handledByMemberId),
            eq(members.tenantId, tenantId),
            eq(members.isDeleted, false),
          ),
        )
        .limit(1);
      if (!memberRow) throw new ValidationError('handledByMemberId does not match a member of this tenant');
      const [association] = await db0
        .select({ memberId: projectMembers.memberId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.memberId, memberRow.id),
          ),
        )
        .limit(1);
      if (!association) {
        throw new ValidationError('handledByMemberId must be a member associated with this project');
      }
      handledBy = memberRow;
    }

    // §12 idempotency: the ledger reference doubles as the retry key. A
    // client-supplied reference is dup-checked inside the transaction; a
    // generated one is date + uuid-suffixed (same shape as dividend runs).
    const refPrefix = type === 'Earning' ? 'PRJ-REV' : 'PRJ-EXP';
    const callerRef = parsed.data.referenceNumber?.trim();
    // #36: the reference is user-facing (Transactions, Expenses, project
    // timeline). A caller-supplied value must look like a business reference,
    // never a bare UUID — reject rather than persist noise into the register.
    if (callerRef && !/^(PRJ-(EXP|REV|RET)|EXP|DEP|TXN)-/i.test(callerRef)) {
      throw new ValidationError(
        'referenceNumber must be a business reference (e.g. PRJ-EXP-… / PRJ-REV-…); omit it to have one generated',
      );
    }
    const refNumber = callerRef ||
      `${refPrefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const db = getDb();

    const result = await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
        .for('update')
        .limit(1);

      if (!project) throw new NotFoundError('Project');

      // Settled & closed projects are immutable records — no more postings.
      if (project.isLocked) {
        throw new LockedError(
          'This project is completed and permanently locked — earnings and expenses can no longer be posted.',
        );
      }

      // #74: a posting with no fund is money that exists nowhere. The project's
      // currentFundBalance would rise while every fund balance stayed flat, so
      // the project view and the treasury could never be reconciled.
      if (!project.linkedFundId) {
        throw new ValidationError(
          'This project has no linked fund, so its earnings and expenses cannot be posted. Link an existing fund or create its dedicated fund first.',
        );
      }

      // §12 idempotency: a retry with the same reference must not post twice.
      const [dupe] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.referenceNumber, refNumber),
            eq(transactions.tenantId, tenantId),
            eq(transactions.isDeleted, false),
          ),
        )
        .limit(1);
      if (dupe) {
        throw new ValidationError('Transaction with this reference number already exists');
      }

      const balanceBeforeCents = toCents(project.currentFundBalance || '0');
      const balanceAfterCents = type === 'Earning' ? balanceBeforeCents + amountCents : balanceBeforeCents - amountCents;

      // §12 financial invariant: server-side overdraft guard. Expenses may never
      // drive the project fund balance negative — client checks are advisory only.
      if (type === 'Expense' && balanceAfterCents < 0) {
        throw new ValidationError(
          `Insufficient project fund balance: available ${fromCents(balanceBeforeCents)}, requested ${fromCents(amountCents)}`,
        );
      }

      const amountStr = fromCents(amountCents);
      const balanceBeforeStr = fromCents(balanceBeforeCents);
      const balanceAfterStr = fromCents(balanceAfterCents);

      const now = new Date();
      await assertFiscalPeriodOpen(tx, tenantId, postingDate);

      // Record the ledger transaction FIRST so the update row can link to it
      // (transactionId): the printable update receipt is keyed on this row —
      // reference number, member and officer live here, not on project_updates.
      // #36: the Expenses register groups by `expense_name` and shows
      // `authorized_by` — without them a project disbursement rendered as an
      // unattributed "—" voucher in the audit trail.
      const [createdTx] = await tx.insert(transactions).values({
        tenantId,
        type: type === 'Earning' ? 'Earning' : 'Expense',
        amount: amountStr,
        description: `${description.trim()} (${project.title})`,
        expenseName: type === 'Earning' ? null : description.trim(),
        category: type === 'Earning' ? 'Project Revenue' : 'Project Expense',
        referenceNumber: refNumber,
        date: postingDate,
        submittedDate: postingDate,
        status: 'Completed',
        projectId: id,
        fundId: project.linkedFundId ?? null,
        // #107: "handled by" records the chosen project associate member
        // (name entry only — see the validation block above); without one it
        // stays the operator, as before.
        handlingOfficer: handledBy ? handledBy.name : user.name,
        memberId: handledBy ? handledBy.id : null,
        // The user performing the disbursement is the approver of record for
        // project postings (there is no separate approval step on this route).
        authorizedBy: user.id,
        balanceBefore: balanceBeforeStr,
        balanceAfter: balanceAfterStr,
        createdBy: user.id,
      }).returning();

      const [updateRecord] = await tx
        .insert(projectUpdates)
        .values({
          tenantId,
          projectId: id,
          type,
          amount: amountStr,
          description: description.trim(),
          date: postingDate,
          balanceBefore: balanceBeforeStr,
          balanceAfter: balanceAfterStr,
          transactionId: createdTx?.id ?? null,
        })
        .returning();

      const projectUpdateFields: Record<string, unknown> = {
        currentFundBalance: balanceAfterStr,
        updatedAt: now,
      };

      if (type === 'Earning') {
        projectUpdateFields.totalEarnings = sql<string>`(${projects.totalEarnings}::numeric + ${amountStr}::numeric)::numeric(15,2)`;
      } else {
        projectUpdateFields.totalExpenses = sql<string>`(${projects.totalExpenses}::numeric + ${amountStr}::numeric)::numeric(15,2)`;
      }

      await tx
        .update(projects)
        .set(projectUpdateFields)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));

      // Sync linked fund balance if present
      if (project.linkedFundId) {
        await tx
          .update(funds)
          .set({
            balance: type === 'Earning'
              ? sql<string>`(${funds.balance}::numeric + ${amountStr}::numeric)::numeric(15,2)`
              : sql<string>`(${funds.balance}::numeric - ${amountStr}::numeric)::numeric(15,2)`,
            updatedAt: now,
          })
          .where(and(eq(funds.id, project.linkedFundId), eq(funds.tenantId, tenantId)));
      }

      // The update record carries the ledger link; the client opens the
      // printable receipt on the transaction id.
      return { ...updateRecord, transactionId: createdTx?.id };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'ADD_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: {
        type,
        amount: fromCents(amountCents),
        description,
        date: postingDate.toISOString(),
        handledByMemberId: handledBy?.id ?? null,
      },
    });

    return NextResponse.json(
      { success: true, data: result, message: 'Project update recorded successfully' },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[PROJECT UPDATE POST ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to record project update' },
      { status: e.statusCode || 500 },
    );
  }
}
