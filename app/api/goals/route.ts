import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { goals, projects } from '@/db/schema/index';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Filter by user unless Manager+ who can see team goals
    if (normalizeRole(user.role) === 'Member') {
      conditions.push(sql`${goals.userId} = ${user.id}`);
    }
    if (status) {
      conditions.push(sql`${goals.status} = ${status}`);
    }
    if (type) {
      conditions.push(sql`${goals.type} = ${type}`);
    }
    if (search) {
      conditions.push(sql`(${goals.title} ILIKE ${'%' + search + '%'} OR ${goals.description} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
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
      .where(whereClause)
      .orderBy(desc(goals.createdAt));

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (err: any) {
    console.error('[GOALS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch goals' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, targetAmount, currentAmount, deadline, type, linkedProjectId } = body;

    if (!title || targetAmount === undefined) {
      throw new ValidationError('title and targetAmount are required');
    }

    const db = getDb();

    const [created] = await db
      .insert(goals)
      .values({
        userId: user.id,
        title: title.trim(),
        description: description ? description.trim() : null,
        targetAmount: String(Number(targetAmount)),
        currentAmount: String(Number(currentAmount || 0)),
        deadline: deadline || null,
        status: 'In Progress',
        type: type || 'Other',
        linkedProjectId: linkedProjectId || null,
      })
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'CREATE_GOAL',
      resourceType: 'Goal',
      resourceId: created?.id,
      details: { title, targetAmount },
    });

    return NextResponse.json({
      success: true,
      data: created,
      message: 'Goal created successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[GOALS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to create goal' },
      { status: err.statusCode || 500 }
    );
  }
}
