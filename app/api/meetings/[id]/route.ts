import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, meetingAttendees, members, users } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ForbiddenError, readJsonBody } from '@/lib/utils/errors';

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
      .leftJoin(users, and(eq(meetings.conductedBy, users.id), eq(users.tenantId, tenantId)))
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
      .limit(1);

    if (!meeting) throw new NotFoundError('Meeting');

    const attendees = await db
      .select({
        id: meetingAttendees.id,
        memberId: meetingAttendees.memberId,
        memberName: memberDisplayNameSql,
        memberCode: members.memberId,
        attendanceStatus: meetingAttendees.attendanceStatus,
        depositStatus: meetingAttendees.depositStatus,
        notes: meetingAttendees.notes,
      })
      .from(meetingAttendees)
      // Inner join prevents a stale cross-tenant memberId in attendee data from
      // leaking even the foreign member identifier or name.
      .innerJoin(members, and(eq(meetingAttendees.memberId, members.id), eq(members.tenantId, tenantId)))
      .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.tenantId, tenantId)));

    return NextResponse.json({
      success: true,
      data: {
        ...meeting,
        attendees,
      },
    });
  } catch (err: any) {
    console.error('[MEETING GET ERROR]', err);
    return apiError(err, 'Failed to fetch meeting');
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

    if (!hasScreenPermission(user, 'MEETINGS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: MEETINGS');
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
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
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'UPDATE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
      details: { updatedFields: Object.keys(updateFields) },
      // Zero extra queries: `existing` was fetched for the guard checks
      // above; `updated` is the UPDATE's .returning().
      before: existing,
      after: updated,
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Meeting updated successfully',
    });
  } catch (err: any) {
    console.error('[MEETING PUT ERROR]', err);
    return apiError(err, 'Failed to update meeting');
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

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to delete meeting');
    }

    const { id } = await params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Meeting');

    await db.delete(meetings).where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)));

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'DELETE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
      // Hard delete: the row is gone after this — the snapshot is the ONLY
      // surviving record of what it contained. `existing` was already fetched.
      before: existing,
    });

    return NextResponse.json({
      success: true,
      message: 'Meeting deleted successfully',
    });
  } catch (err: any) {
    console.error('[MEETING DELETE ERROR]', err);
    return apiError(err, 'Failed to delete meeting');
  }
}
