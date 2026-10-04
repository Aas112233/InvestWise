import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates, funds, transactions } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { disbursementSchema } from '@/lib/utils/validation';
import { requireProjectContext, zodMessage } from '../../_helpers';
import { parsePositiveAmount, toCents, fromCents } from '@/lib/money';
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
    const body = await request.json();
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

    // §12 idempotency: the ledger reference doubles as the retry key. A
    // client-supplied reference is dup-checked inside the transaction; a
    // generated one is date + uuid-suffixed (same shape as dividend runs).
    const refPrefix = type === 'Earning' ? 'PRJ-REV' : 'PRJ-EXP';
    const refNumber = parsed.data.referenceNumber?.trim() ||
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
      const [updateRecord] = await tx
        .insert(projectUpdates)
        .values({
          tenantId,
          projectId: id,
          type,
          amount: amountStr,
          description: description.trim(),
          date: now,
          balanceBefore: balanceBeforeStr,
          balanceAfter: balanceAfterStr,
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

      // Record corresponding ledger transaction for project timeline
      await tx.insert(transactions).values({
        tenantId,
        type: type === 'Earning' ? 'Earning' : 'Expense',
        amount: amountStr,
        description: `${description.trim()} (${project.title})`,
        category: type === 'Earning' ? 'Project Revenue' : 'Project Expense',
        referenceNumber: refNumber,
        date: now,
        submittedDate: now,
        status: 'Completed',
        projectId: id,
        fundId: project.linkedFundId ?? null,
        handlingOfficer: user.name,
        balanceBefore: balanceBeforeStr,
        balanceAfter: balanceAfterStr,
        createdBy: user.id,
      });

      return updateRecord;
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'ADD_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: { type, amount: fromCents(amountCents), description },
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
