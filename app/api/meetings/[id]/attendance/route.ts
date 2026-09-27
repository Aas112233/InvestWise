import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, meetingAttendees, memberPenalties, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to record meeting attendance');
    }

    const { id } = await params;
    const body = await request.json();
    const attendeesList = body.attendees || body;

    if (!Array.isArray(attendeesList) || attendeesList.length === 0) {
      throw new ValidationError('A non-empty array of attendees is required');
    }

    const db = getDb();

    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id))
      .limit(1);

    if (!meeting) throw new NotFoundError('Meeting');

    await db.transaction(async (tx) => {
      for (const item of attendeesList) {
        if (!item.memberId) continue;

        const attendanceStatus = item.attendanceStatus || 'PRESENT';
        const depositStatus = item.depositStatus || 'PENDING';
        const notes = item.notes || null;

        // Check if attendee row exists
        const [existing] = await tx
          .select()
          .from(meetingAttendees)
          .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.memberId, item.memberId)))
          .limit(1);

        if (existing) {
          await tx
            .update(meetingAttendees)
            .set({
              attendanceStatus,
              depositStatus,
              notes,
              updatedAt: new Date(),
            })
            .where(eq(meetingAttendees.id, existing.id));
        } else {
          await tx
            .insert(meetingAttendees)
            .values({
              meetingId: id,
              memberId: item.memberId,
              attendanceStatus,
              depositStatus,
              notes,
            });
        }

        // If unexcused absence, increment member's warning count
        if (attendanceStatus === 'ABSENT') {
          await tx
            .update(members)
            .set({
              warningCount: sql<number>`COALESCE(${members.warningCount}, 0) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(members.id, item.memberId));
        }
      }
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'RECORD_MEETING_ATTENDANCE',
      resourceType: 'Meeting',
      resourceId: id,
      details: { attendeeCount: attendeesList.length },
    });

    return NextResponse.json({
      success: true,
      message: 'Meeting attendance recorded successfully',
    });
  } catch (err: any) {
    console.error('[ATTENDANCE POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record attendance' },
      { status: err.statusCode || 500 }
    );
  }
}
