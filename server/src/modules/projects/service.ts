import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../../lib/db.js';
import { projects } from '../../db/schema/index.js';

/** Projects read service — supports Fund → Project cascading selectors (§5). */

export async function listProjects(query?: { status?: string; fundId?: string }, tenantId?: string) {
  const db = getDb();

  const conditions = [];
  // Tenant predicate first and unconditional when known: without it this is
  // a platform-wide full scan (SEV-002), and the dashboard calls it on load.
  if (tenantId) conditions.push(eq(projects.tenantId, tenantId));
  if (query?.status) conditions.push(eq(projects.status, query.status));
  if (query?.fundId) conditions.push(eq(projects.linkedFundId, query.fundId));

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      category: projects.category,
      status: projects.status,
      budget: projects.budget,
      totalEarnings: projects.totalEarnings,
      totalExpenses: projects.totalExpenses,
      currentFundBalance: projects.currentFundBalance,
      linkedFundId: projects.linkedFundId,
      startDate: projects.startDate,
    })
    .from(projects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(projects.createdAt))
    .limit(500);

  return { data: rows, total: rows.length };
}

export async function getProjectById(id: string) {
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) {
    const err = new Error('Project not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return project;
}
