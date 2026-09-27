import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, meetingAttendees, members, users } from '@/db/schema/index';
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

    const [meeting] = await db
      .select({
        id: meetings.id,
        title: meetings.title,
        meetingDate: meetings.meetingDate,
        meetingType: meetings.meetingType,
        location: meetings.location,
        agenda: meetings.agenda,
        notes: meetings.notes,
        status: meetings.status,
        conductedBy: meetings.conductedBy,
        conductorName: users.name,
        startedAt: meetings.startedAt,
        completedAt: meetings.completedAt,
        createdAt: meetings.createdAt,
      })
      .from(meetings)
      .leftJoin(users, eq(meetings.conductedBy, users.id))
      .where(eq(meetings.id, id))
      .limit(1);

    if (!meeting) throw new NotFoundError('Meeting');

    const attendees = await db
      .select({
        id: meetingAttendees.id,
        memberId: meetingAttendees.memberId,
        memberName: members.name,
        memberCode: members.memberId,
        attendanceStatus: meetingAttendees.attendanceStatus,
        depositStatus: meetingAttendees.depositStatus,
        notes: meetingAttendees.notes,
      })
      .from(meetingAttendees)
      .leftJoin(members, eq(meetingAttendees.memberId, members.id))
      .where(eq(meetingAttendees.meetingId, id));

    return NextResponse.json({
      success: true,
      data: {
        ...meeting,
        attendees,
      },
    });
  } catch (err: any) {
    console.error('[MEETING GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch meeting' },
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
      throw new ForbiddenError('Insufficient permissions to update meeting');
    }

    const { id } = await params;
    const body = await request.json();
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id))
      .limit(1);

    if (!existing) throw new NotFoundError('Meeting');

    const updateFields: Record<string, unknown> = {
      updatedBy: user.id,
      updatedAt: new Date(),
    };

    if (body.title !== undefined) updateFields.title = body.title.trim();
    if (body.meetingDate !== undefined) updateFields.meetingDate = new Date(body.meetingDate);
    if (body.meetingType !== undefined) updateFields.meetingType = body.meetingType.trim();
    if (body.location !== undefined) updateFields.location = body.location.trim();
    if (body.agenda !== undefined) updateFields.agenda = body.agenda ? body.agenda.trim() : null;
    if (body.notes !== undefined) updateFields.notes = body.notes ? body.notes.trim() : null;

    if (body.status !== undefined) {
      updateFields.status = body.status;
      if (body.status === 'IN_PROGRESS' && !existing.startedAt) {
        updateFields.startedAt = new Date();
      } else if (body.status === 'COMPLETED' && !existing.completedAt) {
        updateFields.completedAt = new Date();
      }
    }

    const [updated] = await db
      .update(meetings)
      .set(updateFields)
      .where(eq(meetings.id, id))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'UPDATE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
      details: { updatedFields: Object.keys(updateFields) },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Meeting updated successfully',
    });
  } catch (err: any) {
    console.error('[MEETING PUT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to update meeting' },
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
      throw new ForbiddenError('Admin privilege required to delete meeting');
    }

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id))
      .limit(1);

    if (!existing) throw new NotFoundError('Meeting');

    await db.delete(meetings).where(eq(meetings.id, id));

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'DELETE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
    });

    return NextResponse.json({
      success: true,
      message: 'Meeting deleted successfully',
    });
  } catch (err: any) {
    console.error('[MEETING DELETE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to delete meeting' },
      { status: err.statusCode || 500 }
    );
  }
}
