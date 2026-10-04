import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, users } from '@/db/schema/index';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: tenant-scoped meeting list; no tenant context → no rows.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
    const status = searchParams.get('status');
    const meetingType = searchParams.get('meetingType');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    conditions.push(sql`${meetings.tenantId} = ${tenantId}`);

    if (status) {
      conditions.push(sql`${meetings.status} = ${status}`);
    }
    if (meetingType) {
      conditions.push(sql`${meetings.meetingType} = ${meetingType}`);
    }
    if (search) {
      conditions.push(sql`(${meetings.title} ILIKE ${'%' + search + '%'} OR ${meetings.location} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
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
          conductorName: users.name,
          startedAt: meetings.startedAt,
          completedAt: meetings.completedAt,
          createdAt: meetings.createdAt,
        })
        .from(meetings)
        .leftJoin(users, eq(meetings.conductedBy, users.id))
        .where(whereClause)
        .orderBy(desc(meetings.meetingDate))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[MEETINGS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch meetings' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to schedule meetings');
    }

    const body = await request.json();
    const { title, meetingDate, meetingType, location, agenda, notes } = body;

    if (!title || !meetingDate || !meetingType) {
      throw new ValidationError('title, meetingDate, and meetingType are required');
    }

    const db = getDb();

    const [created] = await db
      .insert(meetings)
      .values({
        tenantId,
        title: title.trim(),
        meetingDate: new Date(meetingDate),
        meetingType: meetingType.trim(),
        location: location ? location.trim() : 'HQ / Online',
        agenda: agenda ? agenda.trim() : null,
        notes: notes ? notes.trim() : null,
        status: 'SCHEDULED',
        conductedBy: user.id,
        createdBy: user.id,
      })
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'SCHEDULE_MEETING',
      resourceType: 'Meeting',
      resourceId: created?.id,
      details: { title, meetingDate, meetingType },
    });

    return NextResponse.json({
      success: true,
      data: created,
      message: 'Meeting scheduled successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[MEETINGS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to schedule meeting' },
      { status: err.statusCode || 500 }
    );
  }
}
