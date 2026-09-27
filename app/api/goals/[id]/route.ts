import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { goals, projects } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

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
        deadline: goals.deadline,
        status: goals.status,
        type: goals.type,
        linkedProjectId: goals.linkedProjectId,
        projectTitle: projects.title,
        createdAt: goals.createdAt,
        updatedAt: goals.updatedAt,
      })
      .from(goals)
      .leftJoin(projects, eq(goals.linkedProjectId, projects.id))
      .where(eq(goals.id, id))
      .limit(1);

    if (!goal) throw new NotFoundError('Goal');

    return NextResponse.json({
      success: true,
      data: goal,
    });
  } catch (err: any) {
    console.error('[GOAL GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch goal' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [existing] = await db
      .select()
      .from(goals)
      .where(eq(goals.id, id))
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
    if (body.targetAmount !== undefined) updateFields.targetAmount = String(Number(body.targetAmount));
    if (body.currentAmount !== undefined) updateFields.currentAmount = String(Number(body.currentAmount));
    if (body.deadline !== undefined) updateFields.deadline = body.deadline || null;
    if (body.type !== undefined) updateFields.type = body.type;
    if (body.linkedProjectId !== undefined) updateFields.linkedProjectId = body.linkedProjectId || null;

    // Check if goal reached target
    const current = Number(body.currentAmount !== undefined ? body.currentAmount : existing.currentAmount);
    const target = Number(body.targetAmount !== undefined ? body.targetAmount : existing.targetAmount);

    if (body.status !== undefined) {
      updateFields.status = body.status;
    } else if (current >= target && target > 0) {
      updateFields.status = 'Completed';
    }

    const [updated] = await db
      .update(goals)
      .set(updateFields)
      .where(eq(goals.id, id))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'UPDATE_GOAL',
      resourceType: 'Goal',
      resourceId: id,
      details: { updatedFields: Object.keys(updateFields) },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Goal updated successfully',
    });
  } catch (err: any) {
    console.error('[GOAL PUT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to update goal' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(goals)
      .where(eq(goals.id, id))
      .limit(1);

    if (!existing) throw new NotFoundError('Goal');

    if (existing.userId !== user.id && user.role !== 'Admin' && user.role !== 'Administrator') {
      throw new ForbiddenError('You can only delete your own goals');
    }

    await db.delete(goals).where(eq(goals.id, id));

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'DELETE_GOAL',
      resourceType: 'Goal',
      resourceId: id,
    });

    return NextResponse.json({
      success: true,
      message: 'Goal deleted successfully',
    });
  } catch (err: any) {
    console.error('[GOAL DELETE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to delete goal' },
      { status: err.statusCode || 500 }
    );
  }
}
