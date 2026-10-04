import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, meetingAttendees, memberPenalties, members } from '@/db/schema/index';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: attendance drives member warning counts — tenant context required.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

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
      .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
      .limit(1);

    if (!meeting) throw new NotFoundError('Meeting');

    await db.transaction(async (tx) => {
      const validItems = attendeesList.filter((item: any) => item?.memberId);
      if (validItems.length === 0) return;

      // Collapse duplicate memberIds keeping the LAST record — matches the
      // old sequential overwrite behavior, and ON CONFLICT DO UPDATE cannot
      // visit the same row twice in one statement.
      const uniqueItems = Array.from(
        new Map(validItems.map((item: any) => [item.memberId, item])).values(),
      ) as Array<{ memberId: string; attendanceStatus?: string; depositStatus?: string; notes?: string }>;

      // One multi-row upsert on uq_meeting_member instead of a per-attendee
      // SELECT + UPDATE/INSERT (previously 2 round trips per attendee).
      await tx
        .insert(meetingAttendees)
        .values(
          uniqueItems.map((item) => ({
            meetingId: id,
            memberId: item.memberId,
            attendanceStatus: item.attendanceStatus || 'PRESENT',
            depositStatus: item.depositStatus || 'PENDING',
            notes: item.notes || null,
          })),
        )
        .onConflictDoUpdate({
          target: [meetingAttendees.meetingId, meetingAttendees.memberId],
          set: {
            attendanceStatus: sql`excluded.attendance_status`,
            depositStatus: sql`excluded.deposit_status`,
            notes: sql`excluded.notes`,
            updatedAt: new Date(),
          },
        });

      // Unexcused absences increment the member's warning count — one grouped
      // UPDATE for all absentees instead of one per attendee.
      const absentMemberIds = uniqueItems
        .filter((item) => (item.attendanceStatus || 'PRESENT') === 'ABSENT')
        .map((item) => item.memberId);

      if (absentMemberIds.length > 0) {
        await tx
          .update(members)
          .set({
            warningCount: sql<number>`COALESCE(${members.warningCount}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(inArray(members.id, absentMemberIds));
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
