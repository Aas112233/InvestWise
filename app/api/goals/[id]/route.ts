import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { goals, projects } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ForbiddenError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents, parsePositiveAmount, MoneyError } from '@/lib/money';

/** §6 guard: tenant business route — resolve tenantId or fail closed. */
async function requireTenantContext(request: NextRequest) {
  const { user, tenantId, error } = await getAuthContext(request);
  if (error || !user) {
    return { error: error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }) } as const;
  }
  if (!tenantId) {
    return { error: NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 }) } as const;
  }
  return { user, tenantId } as const;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireTenantContext(request);
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const db = getDb();

    const [goal] = await db
      .select({
        id: goals.id,
        userId: goals.userId,
        title: goals.title,
        description: goals.description,
        targetAmount: goals.targetAmount,
        currentAmount: goals.currentAmount,
        progressSource: goals.progressSource,
        deadline: goals.deadline,
        status: goals.status,
        type: goals.type,
        linkedProjectId: goals.linkedProjectId,
        projectTitle: projects.title,
        createdAt: goals.createdAt,
        updatedAt: goals.updatedAt,
      })
      .from(goals)
      .leftJoin(projects, and(eq(goals.linkedProjectId, projects.id), eq(projects.tenantId, tenantId)))
      .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
      .limit(1);

    if (!goal) throw new NotFoundError('Goal');
    if (normalizeRole(ctx.user.role) === 'Member' && goal.userId !== ctx.user.id) {
      throw new NotFoundError('Goal');
    }

    return NextResponse.json({
      success: true,
      data: goal,
    });
  } catch (err: any) {
    console.error('[GOAL GET ERROR]', err);
    return apiError(err, 'Failed to fetch goal');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireTenantContext(request);
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const body = await readJsonBody(request);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Goal');

    if (existing.userId !== user.id && normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('You can only update your own goals');
    }

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updateFields.title = body.title.trim();
    if (body.description !== undefined) updateFields.description = body.description ? body.description.trim() : null;
    // §12 money rule (audit 07 M-5): cents parsing, never `String(Number(x))`.
    if (body.targetAmount !== undefined) {
      updateFields.targetAmount = fromCents(parsePositiveAmount(body.targetAmount, { field: 'targetAmount' }));
    }
    if (body.currentAmount !== undefined) {
      const currentCents = toCents(body.currentAmount);
      if (currentCents < 0) throw new ValidationError('currentAmount cannot be negative');
      updateFields.currentAmount = fromCents(currentCents);
    }
    if (body.deadline !== undefined) updateFields.deadline = body.deadline || null;
    if (body.type !== undefined) updateFields.type = body.type;
    if (body.linkedProjectId !== undefined) {
      if (body.linkedProjectId && typeof body.linkedProjectId !== 'string') {
        throw new ForbiddenError('linkedProjectId must be a string');
      }
      if (body.linkedProjectId) {
        const [linkedProject] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, body.linkedProjectId), eq(projects.tenantId, tenantId)))
          .limit(1);
        if (!linkedProject) throw new NotFoundError('Project');
      }
      updateFields.linkedProjectId = body.linkedProjectId || null;
    }

    // Check if goal reached target — compare in integer cents, not floats.
    const current = toCents(body.currentAmount !== undefined ? body.currentAmount : existing.currentAmount);
    const target = toCents(body.targetAmount !== undefined ? body.targetAmount : existing.targetAmount);

    if (body.status !== undefined) {
      updateFields.status = body.status;
    } else if (current >= target && target > 0) {
      updateFields.status = 'Completed';
    }

    const [updated] = await db
      .update(goals)
      .set(updateFields)
      .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'UPDATE_GOAL',
      resourceType: 'Goal',
      resourceId: id,
      details: { updatedFields: Object.keys(updateFields) },
      // Zero extra queries: `existing` was fetched for the guard checks;
      // `updated` is the UPDATE's .returning().
      before: existing,
      after: updated,
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Goal updated successfully',
    });
  } catch (err: any) {
    console.error('[GOAL PUT ERROR]', err);
    // Money validation is a 400, not a 500 (same mapping as dividends).
    if (err instanceof MoneyError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code }, { status: 400 });
    }
    return apiError(err, 'Failed to update goal');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireTenantContext(request);
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Goal');

    if (existing.userId !== user.id && user.role !== 'Admin' && user.role !== 'Administrator') {
      throw new ForbiddenError('You can only delete your own goals');
    }

    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.tenantId, tenantId)));

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'DELETE_GOAL',
      resourceType: 'Goal',
      resourceId: id,
      // Hard delete: the snapshot is the only surviving record of the row.
      // `existing` was already fetched for the ownership guard.
      before: existing,
    });

    return NextResponse.json({
      success: true,
      message: 'Goal deleted successfully',
    });
  } catch (err: any) {
    console.error('[GOAL DELETE ERROR]', err);
    return apiError(err, 'Failed to delete goal');
  }
}
