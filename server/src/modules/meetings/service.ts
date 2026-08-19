import { getDb } from '../../config/database.js';
import {
  meetings,
  meetingAttendees,
  members,
  memberPenalties,
  transactions,
  systemSettings,
  auditLogs,
} from '../../db/schema/index.js';
import { eq, and, desc, sql, inArray, ilike } from 'drizzle-orm';
import { NotFoundError, AppError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import { recalculateMemberPerformance } from '../governance/performance.js';

export interface CreateMeetingInput {
  title: string;
  meetingDate: string | Date;
  meetingType: string;
  location?: string;
  agenda?: string;
  notes?: string;
}

export interface UpdateMeetingInput {
  title?: string;
  meetingDate?: string | Date;
  meetingType?: string;
  location?: string;
  agenda?: string;
  notes?: string;
  status?: string;
}

export interface AttendanceRecordInput {
  memberId: string;
  attendanceStatus: 'PRESENT' | 'ABSENT' | 'EXCUSED';
  notes?: string;
}

/**
 * Determine a member's deposit punctuality status for a given month and meeting date.
 */
async function resolveDepositStatusForMember(
  tx: any,
  memberId: string,
  targetDate: Date,
  depositDueDate: number,
  gracePeriodDays: number,
): Promise<'PAID_ON_TIME' | 'PAID_LATE' | 'PENDING'> {
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth(); // 0-indexed

  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const deadlineDate = new Date(year, month, Math.min(28, depositDueDate + gracePeriodDays), 23, 59, 59, 999);

  // Find deposits made by this member for this month
  const deposits = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.memberId, memberId),
        eq(transactions.type, 'Deposit'),
        inArray(transactions.status, ['Completed']),
        eq(transactions.isDeleted, false),
        sql`${transactions.date} >= ${startOfMonth.toISOString()}::timestamptz`,
        sql`${transactions.date} <= ${endOfMonth.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(transactions.date);

  if (!deposits || deposits.length === 0) {
    return 'PENDING';
  }

  // Earliest deposit date
  const earliestDepositDate = deposits[0].date ? new Date(deposits[0].date) : new Date();
  if (earliestDepositDate <= deadlineDate) {
    return 'PAID_ON_TIME';
  }

  return 'PAID_LATE';
}

export async function createMeeting(data: CreateMeetingInput, userId: string, userName: string) {
  const db = getDb();
  const meetingDate = new Date(data.meetingDate);

  return db.transaction(async (tx) => {
    // 1. Fetch system settings for deposit due parameters
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const depositDueDate = settings?.depositDueDate ?? 10;
    const gracePeriodDays = settings?.gracePeriodDays ?? 3;

    // Deduplication check: prevent rapid duplicate creation within 15 seconds
    const fifteenSecondsAgo = new Date(Date.now() - 15000);
    const [duplicate] = await tx
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.title, data.title.trim()),
          eq(meetings.meetingType, data.meetingType),
          sql`${meetings.createdAt} >= ${fifteenSecondsAgo.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);

    if (duplicate) {
      return {
        ...duplicate,
        totalAttendees: 0,
        isDuplicateSuppressed: true,
      };
    }

    // 2. Insert meeting
    const [meeting] = await tx
      .insert(meetings)
      .values({
        title: data.title.trim(),
        meetingDate,
        meetingType: data.meetingType,
        location: data.location || 'HQ / Online',
        agenda: data.agenda || null,
        notes: data.notes || null,
        status: 'SCHEDULED',
        conductedBy: userId || null,
        createdBy: userId || null,
        updatedBy: userId || null,
      })
      .returning();

    // 3. Populate initial attendee roster from all active members
    const activeMembers = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.status, 'active'));

    if (activeMembers.length > 0) {
      const attendeeInserts = [];
      for (const m of activeMembers) {
        const depositStatus = await resolveDepositStatusForMember(
          tx,
          m.id,
          meetingDate,
          depositDueDate,
          gracePeriodDays,
        );

        attendeeInserts.push({
          meetingId: meeting.id,
          memberId: m.id,
          attendanceStatus: 'ABSENT', // Default until recorded
          depositStatus,
        });
      }

      await tx.insert(meetingAttendees).values(attendeeInserts);
    }

    // 4. Audit Log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'CREATE_MEETING',
      resourceType: 'Meeting',
      resourceId: meeting.id,
      details: {
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        meetingType: meeting.meetingType,
        totalInvited: activeMembers.length,
      },
      status: 'SUCCESS',
    });

    return {
      ...meeting,
      totalAttendees: activeMembers.length,
    };
  });
}

export async function listMeetings(query: Record<string, string | undefined>) {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(query);

  const conditions = [];

  if (query.status) {
    conditions.push(eq(meetings.status, query.status));
  }
  if (query.meetingType) {
    conditions.push(eq(meetings.meetingType, query.meetingType));
  }
  if (query.search) {
    conditions.push(ilike(meetings.title, `%${query.search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count & Paginated Data in parallel
  const [[countResult], rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(meetings)
      .where(whereClause),
    db
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
        startedAt: meetings.startedAt,
        completedAt: meetings.completedAt,
        createdAt: meetings.createdAt,
        updatedAt: meetings.updatedAt,
        totalAttendees: sql<number>`(SELECT COUNT(*) FROM ${meetingAttendees} WHERE ${meetingAttendees.meetingId} = ${meetings.id})`,
        presentCount: sql<number>`(SELECT COUNT(*) FROM ${meetingAttendees} WHERE ${meetingAttendees.meetingId} = ${meetings.id} AND ${meetingAttendees.attendanceStatus} = 'PRESENT')`,
        absentCount: sql<number>`(SELECT COUNT(*) FROM ${meetingAttendees} WHERE ${meetingAttendees.meetingId} = ${meetings.id} AND ${meetingAttendees.attendanceStatus} = 'ABSENT')`,
        excusedCount: sql<number>`(SELECT COUNT(*) FROM ${meetingAttendees} WHERE ${meetingAttendees.meetingId} = ${meetings.id} AND ${meetingAttendees.attendanceStatus} = 'EXCUSED')`,
      })
      .from(meetings)
      .where(whereClause)
      .orderBy(desc(meetings.meetingDate))
      .limit(limit)
      .offset(skip),
  ]);

  const total = Number(countResult?.count ?? 0);

  return formatPaginatedResponse(rows, page, limit, total);
}

export async function getMeetingById(id: string) {
  const db = getDb();

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);

  if (!meeting) throw new NotFoundError('Meeting');

  // Fetch attendees with member profile details
  const attendees = await db
    .select({
      id: meetingAttendees.id,
      memberId: meetingAttendees.memberId,
      attendanceStatus: meetingAttendees.attendanceStatus,
      depositStatus: meetingAttendees.depositStatus,
      notes: meetingAttendees.notes,
      updatedAt: meetingAttendees.updatedAt,
      name: members.name,
      displayId: members.memberId,
      email: members.email,
      role: members.role,
      shares: members.shares,
      avatar: members.avatar,
      warningCount: members.warningCount,
      performanceScore: members.performanceScore,
    })
    .from(meetingAttendees)
    .innerJoin(members, eq(meetingAttendees.memberId, members.id))
    .where(eq(meetingAttendees.meetingId, id))
    .orderBy(members.name);

  // Fetch penalties issued during this meeting
  const penalties = await db
    .select()
    .from(memberPenalties)
    .where(eq(memberPenalties.meetingId, id))
    .orderBy(desc(memberPenalties.createdAt));

  const presentCount = attendees.filter((a) => a.attendanceStatus === 'PRESENT').length;
  const absentCount = attendees.filter((a) => a.attendanceStatus === 'ABSENT').length;
  const excusedCount = attendees.filter((a) => a.attendanceStatus === 'EXCUSED').length;

  return {
    ...meeting,
    stats: {
      total: attendees.length,
      present: presentCount,
      absent: absentCount,
      excused: excusedCount,
      attendanceRate: attendees.length > 0 ? Math.round(((presentCount + excusedCount) / attendees.length) * 100) : 0,
      penaltiesIssuedCount: penalties.length,
    },
    attendees,
    penalties,
  };
}

export async function updateMeeting(id: string, data: UpdateMeetingInput, userId: string, userName: string) {
  const db = getDb();

  const [existing] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Meeting');

  const updateData: Partial<typeof meetings.$inferInsert> = {
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.meetingDate !== undefined) updateData.meetingDate = new Date(data.meetingDate);
  if (data.meetingType !== undefined) updateData.meetingType = data.meetingType;
  if (data.location !== undefined) updateData.location = data.location;
  if (data.agenda !== undefined) updateData.agenda = data.agenda;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.status !== undefined) updateData.status = data.status;

  const [updated] = await db
    .update(meetings)
    .set(updateData)
    .where(eq(meetings.id, id))
    .returning();

  await db.insert(auditLogs).values({
    userId,
    userName,
    action: 'UPDATE_MEETING',
    resourceType: 'Meeting',
    resourceId: id,
    details: { previous: existing, current: updated },
    status: 'SUCCESS',
  });

  return updated;
}

export async function startMeeting(id: string, userId: string, userName: string) {
  const db = getDb();

  const [existing] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Meeting');

  if (existing.status === 'COMPLETED') {
    throw new AppError('Cannot start an already completed meeting', 400, 'MEETING_ALREADY_COMPLETED');
  }

  const [updated] = await db
    .update(meetings)
    .set({
      status: 'IN_PROGRESS',
      startedAt: existing.startedAt || new Date(),
      conductedBy: userId,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, id))
    .returning();

  await db.insert(auditLogs).values({
    userId,
    userName,
    action: 'START_MEETING',
    resourceType: 'Meeting',
    resourceId: id,
    details: { startedAt: updated.startedAt },
    status: 'SUCCESS',
  });

  return updated;
}

export async function recordAttendance(
  meetingId: string,
  records: AttendanceRecordInput[],
  userId: string,
  userName: string,
) {
  const db = getDb();

  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new NotFoundError('Meeting');

  return db.transaction(async (tx) => {
    const updatedRecords = [];

    for (const rec of records) {
      const [existing] = await tx
        .select({ id: meetingAttendees.id })
        .from(meetingAttendees)
        .where(
          and(
            eq(meetingAttendees.meetingId, meetingId),
            eq(meetingAttendees.memberId, rec.memberId),
          ),
        )
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(meetingAttendees)
          .set({
            attendanceStatus: rec.attendanceStatus,
            notes: rec.notes || null,
            updatedAt: new Date(),
          })
          .where(eq(meetingAttendees.id, existing.id))
          .returning();
        updatedRecords.push(updated);
      } else {
        const [inserted] = await tx
          .insert(meetingAttendees)
          .values({
            meetingId,
            memberId: rec.memberId,
            attendanceStatus: rec.attendanceStatus,
            notes: rec.notes || null,
          })
          .returning();
        updatedRecords.push(inserted);
      }
    }

    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'RECORD_ATTENDANCE',
      resourceType: 'Meeting',
      resourceId: meetingId,
      details: { recordsUpdatedCount: records.length },
      status: 'SUCCESS',
    });

    return {
      meetingId,
      updatedCount: updatedRecords.length,
    };
  });
}

export async function completeMeeting(id: string, userId: string, userName: string, notes?: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, id)).for('update').limit(1);
    if (!meeting) throw new NotFoundError('Meeting');

    // 1. Fetch system settings
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const depositDueDate = settings?.depositDueDate ?? 10;
    const gracePeriodDays = settings?.gracePeriodDays ?? 3;

    // 2. Finalize each attendee's deposit status
    const attendees = await tx
      .select()
      .from(meetingAttendees)
      .where(eq(meetingAttendees.meetingId, id));

    for (const att of attendees) {
      const liveDepositStatus = await resolveDepositStatusForMember(
        tx,
        att.memberId,
        meeting.meetingDate,
        depositDueDate,
        gracePeriodDays,
      );

      await tx
        .update(meetingAttendees)
        .set({
          depositStatus: liveDepositStatus,
          updatedAt: new Date(),
        })
        .where(eq(meetingAttendees.id, att.id));
    }

    // 3. Mark meeting as COMPLETED
    const [completed] = await tx
      .update(meetings)
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
        notes: notes || meeting.notes,
        updatedBy: userId || null,
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, id))
      .returning();

    // 4. Audit Log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'COMPLETE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
      details: {
        title: meeting.title,
        completedAt: completed.completedAt,
        attendeesCount: attendees.length,
      },
      status: 'SUCCESS',
    });

    // 5. Trigger performance score recalculation for all active members
    // We execute this asynchronously so the meeting completion response is fast
    setTimeout(async () => {
      try {
        for (const att of attendees) {
          await recalculateMemberPerformance(att.memberId);
        }
      } catch (err) {
        console.error('Error recalculating performance scores post meeting completion:', err);
      }
    }, 50);

    return completed;
  });
}

export async function deleteMeeting(id: string, userId: string, userName: string) {
  const db = getDb();

  const [existing] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!existing) throw new NotFoundError('Meeting');

  if (existing.status === 'COMPLETED') {
    throw new AppError('Cannot delete a completed meeting with recorded history', 400, 'COMPLETED_MEETING_DELETE');
  }

  await db.delete(meetings).where(eq(meetings.id, id));

  await db.insert(auditLogs).values({
    userId,
    userName,
    action: 'DELETE_MEETING',
    resourceType: 'Meeting',
    resourceId: id,
    details: { title: existing.title, meetingDate: existing.meetingDate },
    status: 'SUCCESS',
  });

  return { success: true, message: 'Meeting deleted successfully' };
}
