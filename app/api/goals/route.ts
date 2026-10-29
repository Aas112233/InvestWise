import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { goals, projects } from '@/db/schema/index';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents, parsePositiveAmount, MoneyError } from '@/lib/money';
import { escapeLikePattern } from '@/lib/utils/validation';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: tenant-scoped goal list; no tenant context → no rows.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    conditions.push(sql`${goals.tenantId} = ${tenantId}`);

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
      conditions.push(sql`(${goals.title} ILIKE ${'%' + escapeLikePattern(search) + '%'} OR ${goals.description} ILIKE ${'%' + escapeLikePattern(search) + '%'})`);
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
      .where(whereClause)
      .orderBy(desc(goals.createdAt));

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (err: any) {
    console.error('[GOALS GET ERROR]', err);
    return apiError(err, 'Failed to fetch goals');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const body = await readJsonBody(request);
    const { title, description, targetAmount, currentAmount, deadline, type, linkedProjectId } = body;

    if (!title || targetAmount === undefined) {
      throw new ValidationError('title and targetAmount are required');
    }
    if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
      throw new ValidationError('title must be a string of 1-200 characters');
    }

    // §12 money rule (audit 07 M-5): cents parsing with the shared ceiling —
    // never `String(Number(x))`, which passes "NaN" and loses precision.
    const targetCents = parsePositiveAmount(targetAmount, { field: 'targetAmount' });
    const currentCents =
      currentAmount === undefined || currentAmount === null || currentAmount === ''
        ? 0
        : toCents(currentAmount);
    if (currentCents < 0) throw new ValidationError('currentAmount cannot be negative');

    const db = getDb();
    if (linkedProjectId !== undefined && linkedProjectId !== null && linkedProjectId !== '') {
      if (typeof linkedProjectId !== 'string') throw new ValidationError('linkedProjectId must be a string');
      const [linkedProject] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, linkedProjectId), eq(projects.tenantId, tenantId)))
        .limit(1);
      if (!linkedProject) throw new NotFoundError('Project');
    }

    const [created] = await db
      .insert(goals)
      .values({
        tenantId,
        userId: user.id,
        title: title.trim(),
        description: description ? description.trim() : null,
        targetAmount: fromCents(targetCents),
        currentAmount: fromCents(currentCents),
        deadline: deadline || null,
        status: 'In Progress',
        type: type || 'Other',
        linkedProjectId: linkedProjectId || null,
      })
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'CREATE_GOAL',
      resourceType: 'Goal',
      resourceId: created?.id,
      details: { title, targetAmount },
      // Create flow: after-only — `created` is the INSERT's .returning().
      after: created,
    });

    return NextResponse.json({
      success: true,
      data: created,
      message: 'Goal created successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[GOALS POST ERROR]', err);
    // Money validation is a 400, not a 500 (same mapping as dividends).
    if (err instanceof MoneyError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code }, { status: 400 });
    }
    return apiError(err, 'Failed to create goal');
  }
}
