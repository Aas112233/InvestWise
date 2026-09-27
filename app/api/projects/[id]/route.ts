import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates, projectMembers, members } from '@/db/schema/index';
import { eq, desc } from 'drizzle-orm';
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

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!project) throw new NotFoundError('Project');

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
          sharesInvested: projectMembers.sharesInvested,
          ownershipPercentage: projectMembers.ownershipPercentage,
        })
        .from(projectMembers)
        .leftJoin(members, eq(projectMembers.memberId, members.id))
        .where(eq(projectMembers.projectId, id)),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        ...project,
        updates,
        involvedMembers: participants,
      },
    });
  } catch (err: any) {
    console.error('[PROJECT GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch project' },
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

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to modify project');
    }

    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!existing) throw new NotFoundError('Project');

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updateFields.title = body.title.trim();
    if (body.category !== undefined) updateFields.category = body.category.trim();
    if (body.description !== undefined) updateFields.description = body.description.trim();
    if (body.budget !== undefined) updateFields.budget = String(Number(body.budget));
    if (body.expectedRoi !== undefined) updateFields.expectedRoi = String(Number(body.expectedRoi));
    if (body.status !== undefined) updateFields.status = body.status;
    if (body.health !== undefined) updateFields.health = body.health;
    if (body.startDate !== undefined) updateFields.startDate = body.startDate;
    if (body.completionDate !== undefined) updateFields.completionDate = body.completionDate || null;
    if (body.linkedFundId !== undefined) updateFields.linkedFundId = body.linkedFundId || null;
    if (body.projectFundHandler !== undefined) updateFields.projectFundHandler = body.projectFundHandler || null;

    const [updated] = await db
      .update(projects)
      .set(updateFields)
      .where(eq(projects.id, id))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'UPDATE_PROJECT',
      resourceType: 'Project',
      resourceId: id,
      details: { updatedFields: Object.keys(updateFields) },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Project updated successfully',
    });
  } catch (err: any) {
    console.error('[PROJECT PUT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to update project' },
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

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to delete project');
    }

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!existing) throw new NotFoundError('Project');

    // Soft delete: update status to Cancelled
    const [cancelled] = await db
      .update(projects)
      .set({
        status: 'Cancelled',
        health: 'Critical',
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
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
  } catch (err: any) {
    console.error('[PROJECT DELETE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to cancel project' },
      { status: err.statusCode || 500 }
    );
  }
}
