import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates, projectMembers, members, funds, systemSettings } from '@/db/schema/index';
import { eq, and, desc } from 'drizzle-orm';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError } from '@/lib/utils/errors';
import { projectUpdateSchema } from '@/lib/utils/validation';
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

    const [updates, participants] = await Promise.all([
      db
        .select()
        .from(projectUpdates)
        .where(eq(projectUpdates.projectId, id))
        .orderBy(desc(projectUpdates.date)),
      db
        .select({
          memberId: projectMembers.memberId,
          memberName: members.name,
          memberCode: members.memberId,
          memberPhone: members.phone,
          memberStatus: members.status,
          sharesInvested: projectMembers.sharesInvested,
          ownershipPercentage: projectMembers.ownershipPercentage,
        })
        .from(projectMembers)
        .leftJoin(members, and(eq(projectMembers.memberId, members.id), eq(members.tenantId, tenantId)))
        .where(eq(projectMembers.projectId, id)),
    ]);

    const enrichedParticipants = participants.map((p) => {
      const shares = Number(p.sharesInvested || 0);
      return {
        ...p,
        tenantShareValue: shareValue,
        totalInvested: shares * shareValue,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        ...project,
        linkedFundName: projectWithFund.fundName || undefined,
        linkedFundBalance: projectWithFund.fundBalance ? Number(projectWithFund.fundBalance) : undefined,
        updates,
        involvedMembers: enrichedParticipants,
        tenantShareValue: shareValue,
      },
    });
  } catch (err: unknown) {
    console.error('[PROJECT GET ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to fetch project' },
      { status: e.statusCode || 500 },
    );
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

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Project');

    const body = await request.json();
    const parsed = projectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: zodMessage(parsed.error) },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // §6: a linked fund (when changed) must belong to this tenant.
    if (data.linkedFundId !== undefined) {
      await assertFundInTenant(data.linkedFundId, tenantId);
    }

    // Map only validated, present fields (never raw client values).
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateFields.title = data.title;
    if (data.category !== undefined) updateFields.category = data.category;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.budget !== undefined) updateFields.budget = String(data.budget);
    if (data.initialInvestment !== undefined) updateFields.initialInvestment = String(data.initialInvestment);
    if (data.expectedRoi !== undefined) updateFields.expectedRoi = String(data.expectedRoi);
    if (data.status !== undefined) updateFields.status = data.status;
    if (data.health !== undefined) updateFields.health = data.health;
    if (data.startDate !== undefined) updateFields.startDate = data.startDate;
    if (data.completionDate !== undefined) updateFields.completionDate = data.completionDate ?? null;
    if (data.linkedFundId !== undefined) updateFields.linkedFundId = data.linkedFundId ?? null;
    if (data.projectFundHandler !== undefined) updateFields.projectFundHandler = data.projectFundHandler ?? null;

    // §6 audit: record old → new for every field actually changed. Money
    // fields are decimal(15,2) strings in the row ("5000.00") vs numeric
    // request values — normalize so formatting can't mask or fake a diff.
    const moneyFields = new Set(['budget', 'initialInvestment', 'expectedRoi']);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, to] of Object.entries(updateFields)) {
      if (field === 'updatedAt') continue;
      const beforeRaw = (existing as unknown as Record<string, unknown>)[field];
      const before = moneyFields.has(field) ? Number(beforeRaw ?? 0) : beforeRaw;
      const after = moneyFields.has(field) ? Number(to) : to;
      if (before !== after) changes[field] = { from: before, to: after };
    }

    const [updated] = await db
      .update(projects)
      .set(updateFields)
      .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'UPDATE_PROJECT',
      resourceType: 'Project',
      resourceId: id,
      details: { changes },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Project updated successfully',
    });
  } catch (err: unknown) {
    console.error('[PROJECT PUT ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to update project' },
      { status: e.statusCode || 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // §6/RBAC: cancel is a destructive write — Manager/Admin/SuperAdmin only.
    const ctx = await requireProjectContext(request, { write: true });
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Project');

    // Soft delete: mark Cancelled (never hard delete financial records).
    const [cancelled] = await db
      .update(projects)
      .set({ status: 'Cancelled', health: 'Critical', updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'CANCEL_PROJECT',
      resourceType: 'Project',
      resourceId: id,
    });

    return NextResponse.json({
      success: true,
      data: cancelled,
      message: 'Project cancelled successfully',
    });
  } catch (err: unknown) {
    console.error('[PROJECT DELETE ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to cancel project' },
      { status: e.statusCode || 500 },
    );
  }
}
