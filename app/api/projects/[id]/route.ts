import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates, projectMembers, members, funds, systemSettings, transactions, goals } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { logAudit } from '@/lib/utils/audit';
import { LockedError, NotFoundError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { projectUpdateSchema } from '@/lib/utils/validation';
import { toCents, fromCents } from '@/lib/money';
import { investProjectCapital, refundProjectCapital } from '@/lib/project-capital';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { requireProjectContext, zodMessage, assertFundInTenant } from '../_helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireProjectContext(request);
    if ('error' in ctx) return ctx.error;
    const { tenantId } = ctx;

    const { id } = await params;
    const db = getDb();

    const [projectWithFund] = await db
      .select({
        project: projects,
        fundName: funds.name,
        fundBalance: funds.balance,
      })
      .from(projects)
      .leftJoin(funds, and(eq(projects.linkedFundId, funds.id), eq(funds.tenantId, tenantId)))
      .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
      .limit(1);

    if (!projectWithFund || !projectWithFund.project) throw new NotFoundError('Project');
    const project = projectWithFund.project;

    // Fetch tenant share value for valuation calculations
    const [settingRow] = await db
      .select({ shareValueBdt: systemSettings.shareValueBdt })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, tenantId))
      .limit(1);
    const shareValue = Number(settingRow?.shareValueBdt || 1000);

    const [updates, participants, investmentLegs, otherMovement] = await Promise.all([
      db
        .select()
        .from(projectUpdates)
        .where(and(eq(projectUpdates.projectId, id), eq(projectUpdates.isDeleted, false)))
        .orderBy(desc(projectUpdates.createdAt), desc(projectUpdates.date), desc(projectUpdates.id)),
      db
        .select({
          memberId: projectMembers.memberId,
          memberName: memberDisplayNameSql,
          memberCode: members.memberId,
          memberPhone: members.phone,
          memberStatus: members.status,
          sharesInvested: projectMembers.sharesInvested,
          ownershipPercentage: projectMembers.ownershipPercentage,
        })
        .from(projectMembers)
        .leftJoin(members, and(eq(projectMembers.memberId, members.id), eq(members.tenantId, tenantId)))
        .where(eq(projectMembers.projectId, id)),
      // Where each shareholder's money actually came from, so the edit form can
      // prefill (and re-run) the capital allocation exactly as it was applied.
      db
        .select({
          memberId: transactions.memberId,
          sourceFundId: transactions.sourceFundId,
          sourceFundName: funds.name,
          amount: transactions.amount,
        })
        .from(transactions)
        .leftJoin(funds, and(eq(funds.id, transactions.sourceFundId), eq(funds.tenantId, tenantId)))
        .where(and(
          eq(transactions.projectId, id),
          eq(transactions.tenantId, tenantId),
          eq(transactions.isDeleted, false),
          eq(transactions.type, 'Project Investment'),
        )),
      // Any settled movement other than the initial investment (Earning,
      // Expense, dividend, …) locks the capital structure — see PUT.
      db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(
          eq(transactions.projectId, id),
          eq(transactions.tenantId, tenantId),
          eq(transactions.isDeleted, false),
          ne(transactions.type, 'Project Investment'),
        ))
        .limit(1),
    ]);

    const investedByMember = new Map<string, { cents: number; sourceFundId: string | null; sourceFundName: string | null }>();
    for (const leg of investmentLegs) {
      if (!leg.memberId) continue;
      const prev = investedByMember.get(leg.memberId);
      const cents = toCents(leg.amount ?? '0') + (prev?.cents ?? 0);
      investedByMember.set(leg.memberId, {
        cents,
        sourceFundId: leg.sourceFundId ?? prev?.sourceFundId ?? null,
        sourceFundName: leg.sourceFundName ?? prev?.sourceFundName ?? null,
      });
    }

    const enrichedParticipants = participants.map((p) => {
      const shares = Number(p.sharesInvested || 0);
      const leg = investedByMember.get(p.memberId);
      return {
        ...p,
        tenantShareValue: shareValue,
        // Prefer the ledger figure: it survives a later share-value change.
        totalInvested: leg ? leg.cents / 100 : shares * shareValue,
        sourceFundId: leg?.sourceFundId ?? null,
        sourceFundName: leg?.sourceFundName ?? null,
      };
    });

    const capitalLocked = Boolean(otherMovement[0]) || updates.length > 0;

    // Issuing a charter is an act that has to be traceable, the same as any
    // other financial document. Only the print view asks for it.
    if (new URL(request.url).searchParams.get('purpose') === 'print') {
      await logAudit({
        user: { id: ctx.user?.id, name: ctx.user?.name },
        tenantId,
        action: 'PRINT_DOCUMENT',
        resourceType: 'Project',
        resourceId: id,
        details: {
          title: project.title,
          status: project.status,
          totalCapital: project.initialInvestment,
          isLocked: project.isLocked,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...project,
        linkedFundName: projectWithFund.fundName || undefined,
        linkedFundBalance: projectWithFund.fundBalance ? Number(projectWithFund.fundBalance) : undefined,
        updates,
        involvedMembers: enrichedParticipants,
        tenantShareValue: shareValue,
        capitalLocked,
      },
    });
  } catch (err: unknown) {
    console.error('[PROJECT GET ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return apiError(e, 'Failed to fetch project');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const db = getDb();
    const now = new Date();

    const body = await readJsonBody(request);
    const parsed = projectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: zodMessage(parsed.error) },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // `.partial()` keeps create's `default([])`, so an omitted `shareholders`
    // key still parses to `[]`. Detect presence from the RAW body, otherwise a
    // descriptive-only edit would read as "remove every shareholder".
    const capitalInBody =
      Boolean(body) && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'shareholders');

    // §6: a linked fund (when changed) must belong to this tenant.
    if (data.linkedFundId !== undefined) {
      await assertFundInTenant(data.linkedFundId, tenantId);
    }

    const outcome = await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
        .for('update')
        .limit(1);
      if (!project) throw new NotFoundError('Project');

      // Settled & closed projects are immutable records — no edits, ever.
      if (project.isLocked) {
        throw new LockedError(
          'This project is completed and permanently locked — it can no longer be edited.',
        );
      }

      // Map only validated, present fields (never raw client values).
      // `initialInvestment`, `currentFundBalance` and `totalShares` are derived
      // from the ledger and are written only by the reallocation below.
      const updateFields: Record<string, unknown> = { updatedAt: now };
      if (data.title !== undefined) updateFields.title = data.title;
      if (data.category !== undefined) updateFields.category = data.category;
      if (data.description !== undefined) updateFields.description = data.description;
      if (data.budget !== undefined) updateFields.budget = String(data.budget);
      if (data.expectedRoi !== undefined) updateFields.expectedRoi = String(data.expectedRoi);
      if (data.status !== undefined) updateFields.status = data.status;
      if (data.health !== undefined) updateFields.health = data.health;
      if (data.startDate !== undefined) updateFields.startDate = data.startDate;
      if (data.completionDate !== undefined) updateFields.completionDate = data.completionDate ?? null;
      if (data.linkedFundId !== undefined) updateFields.linkedFundId = data.linkedFundId ?? null;
      if (data.projectFundHandler !== undefined) updateFields.projectFundHandler = data.projectFundHandler ?? null;

      // Current capital structure, read from the rows that define it.
      const currentRows = await tx
        .select({
          memberId: projectMembers.memberId,
          sharesInvested: projectMembers.sharesInvested,
        })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, id));
      const legRows = await tx
        .select({
          memberId: transactions.memberId,
          sourceFundId: transactions.sourceFundId,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(and(
          eq(transactions.projectId, id),
          eq(transactions.tenantId, tenantId),
          eq(transactions.isDeleted, false),
          eq(transactions.type, 'Project Investment'),
        ));
      const sourceByMember = new Map<string, string | null>();
      for (const leg of legRows) {
        if (leg.memberId) sourceByMember.set(leg.memberId, leg.sourceFundId ?? null);
      }
      const investedCents = legRows.reduce((acc, l) => acc + toCents(l.amount ?? '0'), 0);

      const signature = (rows: Array<{ memberId: string; shares: number; sourceFundId: string | null }>) =>
        rows
          .map((r) => `${r.memberId}:${r.shares}:${r.sourceFundId ?? 'none'}`)
          .sort()
          .join('|');

      const currentSig = signature(
        currentRows.map((r) => ({
          memberId: r.memberId,
          shares: Number(r.sharesInvested || 0),
          sourceFundId: sourceByMember.get(r.memberId) ?? null,
        })),
      );
      const requested = capitalInBody ? data.shareholders : undefined;
      const requestedSig = requested
        ? signature(requested.map((s) => ({ memberId: s.memberId, shares: s.shares, sourceFundId: s.sourceFundId ?? null })))
        : currentSig;
      const capitalChanged = requested !== undefined && requestedSig !== currentSig;

      if (capitalChanged) {
        // Ledger lock: once the project has earnings, expenses or any other
        // movement, its capital structure is history — reallocating would strand
        // those postings against a different equity base.
        const [otherMovement] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(
            eq(transactions.projectId, id),
            eq(transactions.tenantId, tenantId),
            eq(transactions.isDeleted, false),
            ne(transactions.type, 'Project Investment'),
          ))
          .limit(1);
        const [priorUpdate] = await tx
          .select({ id: projectUpdates.id })
          .from(projectUpdates)
          .where(and(eq(projectUpdates.projectId, id), eq(projectUpdates.tenantId, tenantId)))
          .limit(1);
        if (otherMovement || priorUpdate) {
          throw new ValidationError(
            'The shareholders of this project are locked: it already has earnings or expenses recorded. Reverse those entries before changing its capital.',
          );
        }
        if (investedCents > 0) {
          await assertFiscalPeriodOpen(tx, tenantId, now);
        }

        // Refund the old allocation, then invest the new one — the very same
        // primitives create and delete use, so an edit cannot drift from them.
        const refund = await refundProjectCapital(tx, {
          tenantId,
          projectId: id,
          destinationFundId: project.linkedFundId,
          actorId: user.id,
          reason: 'Project capital reallocated by edit',
          now,
        });

        const [settingRow] = await tx
          .select({ shareValueBdt: systemSettings.shareValueBdt })
          .from(systemSettings)
          .where(eq(systemSettings.tenantId, tenantId))
          .limit(1);
        const shareValue = Number(settingRow?.shareValueBdt || 1000);

        const capital = await investProjectCapital(tx, {
          tenantId,
          shareValue,
          destinationFundId: project.linkedFundId,
          budgetCents: toCents(data.budget ?? Number(project.budget ?? 0)),
          shareholders: requested ?? [],
          now,
        });

        await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
        if (capital.shareholders.length > 0) {
          await tx.insert(projectMembers).values(
            capital.shareholders.map((ps) => ({
              projectId: id,
              memberId: ps.memberId,
              sharesInvested: ps.shares,
              ownershipPercentage: ps.ownershipPercentage,
            })),
          );

          const runRef = `PRJ-INV-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await tx.insert(transactions).values(
            capital.shareholders.map((ps, i) => ({
              tenantId,
              type: 'Project Investment',
              amount: ps.investmentFormatted,
              description: `Equity investment in project: ${project.title} (${ps.shares} ${ps.shares === 1 ? 'share' : 'shares'} @ ${shareValue.toFixed(2)})`,
              category: 'Investment',
              referenceNumber: `${runRef}-${(i + 1).toString().padStart(2, '0')}`,
              date: now,
              submittedDate: now,
              status: 'Completed',
              memberId: ps.memberId,
              projectId: id,
              fundId: project.linkedFundId,
              sourceFundId: ps.sourceFundId,
              handlingOfficer: user.name,
              balanceBefore: ps.memberEquityBefore,
              balanceAfter: ps.memberEquityAfter,
              createdBy: user.id,
            })),
          );
        }

        updateFields.totalShares = capital.totalShares;
        updateFields.initialInvestment = fromCents(capital.totalCents);
        // Earnings/expenses are excluded above, so the live balance IS capital.
        updateFields.currentFundBalance = fromCents(capital.totalCents);
      } else if (data.budget !== undefined) {
        // No reallocation: budget stays the ceiling over the capital raised.
        if (investedCents > toCents(data.budget)) {
          throw new ValidationError(
            `Budget cannot be lower than the capital already invested (${fromCents(investedCents)}).`,
          );
        }
      }

      // §6 audit: record old → new for every field actually changed. Money
      // fields are decimal(15,2) strings in the row ("5000.00") vs numeric
      // request values — normalize so formatting can't mask or fake a diff.
      const moneyFields = new Set(['budget', 'initialInvestment', 'expectedRoi', 'currentFundBalance', 'totalShares']);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [field, to] of Object.entries(updateFields)) {
        if (field === 'updatedAt') continue;
        const beforeRaw = (project as unknown as Record<string, unknown>)[field];
        const before = moneyFields.has(field) ? Number(beforeRaw ?? 0) : beforeRaw;
        const after = moneyFields.has(field) ? Number(to) : to;
        if (before !== after) changes[field] = { from: before, to: after };
      }

      const [updated] = await tx
        .update(projects)
        .set(updateFields)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
        .returning();

      return { before: project, updated, changes };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'UPDATE_PROJECT',
      resourceType: 'Project',
      resourceId: id,
      details: { changes: outcome.changes },
      // Zero extra queries: `before` was locked and read for the diff inside the
      // transaction; `updated` is the UPDATE's .returning().
      before: outcome.before,
      after: outcome.updated,
    });

    return NextResponse.json({
      success: true,
      data: outcome.updated,
      message: 'Project updated successfully',
    });
  } catch (err: unknown) {
    console.error('[PROJECT UPDATE ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return apiError(e, 'Failed to update project');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // §6/RBAC: deleting a project unwinds money — Manager/Admin/SuperAdmin only.
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const db = getDb();
    const now = new Date();

    const outcome = await db.transaction(async (tx) => {
      // Lock the project first; every write below is tenant-scoped.
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
        .for('update')
        .limit(1);
      if (!project) throw new NotFoundError('Project');

      // Settled & closed projects are immutable records — no deletion, ever.
      if (project.isLocked) {
        throw new LockedError(
          'This project is completed and permanently locked — it can no longer be deleted.',
        );
      }

      // §12 delete gate: a project with earnings, expenses or any other money
      // movement cannot be unwound by deletion — those must be reversed through
      // their own flows first. Only a project funded solely by the untouched
      // initial shareholder investment is refundable here.
      const [disbursement] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.projectId, id),
            eq(transactions.tenantId, tenantId),
            eq(transactions.isDeleted, false),
            ne(transactions.type, 'Project Investment'),
          ),
        )
        .limit(1);
      if (disbursement) {
        throw new ValidationError(
          'This project has earnings, expenses or other transactions. Reverse them before deleting — only a project funded solely by shareholder investment can be deleted.',
        );
      }
      const [priorUpdate] = await tx
        .select({ id: projectUpdates.id })
        .from(projectUpdates)
        .where(and(eq(projectUpdates.projectId, id), eq(projectUpdates.tenantId, tenantId)))
        .limit(1);
      if (priorUpdate) {
        throw new ValidationError('This project has recorded updates. Reverse them before deleting.');
      }

      // Fiscal guard first (§12): reversing money may not silently close a
      // period. Only needed when there is capital to move.
      if (toCents(project.currentFundBalance ?? '0') > 0) {
        await assertFiscalPeriodOpen(tx, tenantId, now);
      }

      // Return the invested capital to member deposits and their source funds
      // and debit the project fund — the exact reverse of the create movement,
      // shared with project edit so the two can never drift.
      const refund = await refundProjectCapital(tx, {
        tenantId,
        projectId: id,
        destinationFundId: project.linkedFundId,
        actorId: user.id,
        reason: 'Project deleted; capital returned to member deposits',
        detachFromProject: true,
        now,
      });

      // Release the non-financial project references, then remove the project.
      let removedFundId: string | null = null;
      await tx
        .update(goals)
        .set({ linkedProjectId: null })
        .where(and(eq(goals.linkedProjectId, id), eq(goals.tenantId, tenantId)));

      // A fund auto-created for this project and now emptied by the refund is
      // removed with it, so deleting a project never leaves an orphaned
      // zero-balance fund in the treasury. Any fund with balance stays.
      if (project.linkedFundId) {
        const [projectFund] = await tx
          .select({ id: funds.id, type: funds.type, linkedProjectId: funds.linkedProjectId, balance: funds.balance })
          .from(funds)
          .where(and(eq(funds.id, project.linkedFundId), eq(funds.tenantId, tenantId)))
          .for('update')
          .limit(1);
        if (
          projectFund &&
          (projectFund.type ?? '').toUpperCase() === 'PROJECT' &&
          projectFund.linkedProjectId === id &&
          toCents(projectFund.balance ?? '0') === 0
        ) {
          // transactions.fund_id is a NO ACTION FK — detach the retained
          // (soft-deleted) audit rows before dropping the fund.
          await tx
            .update(transactions)
            .set({ fundId: null })
            .where(and(eq(transactions.fundId, projectFund.id), eq(transactions.tenantId, tenantId)));
          await tx.delete(funds).where(and(eq(funds.id, projectFund.id), eq(funds.tenantId, tenantId)));
          removedFundId = projectFund.id;
        }
      }

      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      await tx.delete(projects).where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));

      return {
        project,
        refundCents: refund.refundedCents,
        untrackedRefundCents: refund.untrackedCents,
        shareholderCount: refund.shareholderCount,
        fundId: project.linkedFundId,
        removedFundId,
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'DELETE_PROJECT',
      resourceType: 'Project',
      resourceId: id,
      details: {
        title: outcome.project.title,
        refunded: fromCents(outcome.refundCents),
        // Equity restored without a traceable source fund to re-credit
        // (pre-0015 investment legs).
        untrackedRefunded: fromCents(outcome.untrackedRefundCents),
        shareholderCount: outcome.shareholderCount,
        fundId: outcome.fundId,
        dedicatedFundRemoved: outcome.removedFundId,
      },
      before: outcome.project,
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        refunded: fromCents(outcome.refundCents),
        shareholderCount: outcome.shareholderCount,
      },
      message:
        outcome.refundCents > 0
          ? `Project deleted and ${fromCents(outcome.refundCents)} returned to member deposits.`
          : 'Project deleted.',
    });
  } catch (err: unknown) {
    console.error('[PROJECT DELETE ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return apiError(e, 'Failed to delete project');
  }
}

