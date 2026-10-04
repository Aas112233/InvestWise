import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projectUpdates, projects } from '@/db/schema/index';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireProjectContext } from '../_helpers';

export const dynamic = 'force-dynamic';

// Bounded page size: 5 years of disbursements is tens of thousands of rows —
// this endpoint used to return all of them in one payload.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectContext(request);
    if ('error' in ctx) return ctx.error;
    const { tenantId } = ctx;

    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') || undefined;
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE),
    );

    const db = getDb();
    const conditions = [eq(projectUpdates.tenantId, tenantId)];
    if (projectId) {
      conditions.push(eq(projectUpdates.projectId, projectId));
    }
    const where = and(...conditions);

    // The join only decorates rows with project titles — every predicate lives
    // on project_updates, so the count runs against the base table.
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: projectUpdates.id,
          projectId: projectUpdates.projectId,
          projectTitle: projects.title,
          projectCategory: projects.category,
          type: projectUpdates.type,
          amount: projectUpdates.amount,
          description: projectUpdates.description,
          date: projectUpdates.date,
          balanceBefore: projectUpdates.balanceBefore,
          balanceAfter: projectUpdates.balanceAfter,
          createdAt: projectUpdates.createdAt,
        })
        .from(projectUpdates)
        .innerJoin(projects, and(eq(projectUpdates.projectId, projects.id), eq(projects.tenantId, tenantId)))
        .where(where)
        .orderBy(desc(projectUpdates.date))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(projectUpdates).where(where),
    ]);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { page, pageSize, total: totalRow[0]?.total ?? 0 },
    });
  } catch (err: unknown) {
    console.error('[PROJECT UPDATES LIST ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to fetch project updates' },
      { status: e.statusCode || 500 },
    );
  }
}
