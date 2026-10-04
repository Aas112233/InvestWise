import { getDb } from '../../config/database.js';
import { members, projects, projectMembers } from '../../db/schema/index.js';
import { eq, sql, and } from 'drizzle-orm';

export async function recalculateAllMemberShares(): Promise<{ updated: number }> {
  // In InvestWise, member shares are fixed equity allocations set at creation/transfer.
  // They are never recomputed or altered by calculations or deposits.
  return { updated: 0 };
}

export async function checkProjectShareInvariants(tenantId?: string) {
  const db = getDb();
  const projectScope = tenantId ? eq(projects.tenantId, tenantId) : undefined;
  const pmScope = tenantId ? eq(projectMembers.tenantId, tenantId) : undefined;

  const projectQuery = projectScope
    ? db.select({ id: projects.id, title: projects.title, totalShares: projects.totalShares }).from(projects).where(projectScope)
    : db.select({ id: projects.id, title: projects.title, totalShares: projects.totalShares }).from(projects);

  const pmQuery = pmScope
    ? db
        .select({
          projectId: projectMembers.projectId,
          allocated: sql<number>`COALESCE(SUM(${projectMembers.sharesInvested}), 0)`,
        })
        .from(projectMembers)
        .where(pmScope)
        .groupBy(projectMembers.projectId)
    : db
        .select({
          projectId: projectMembers.projectId,
          allocated: sql<number>`COALESCE(SUM(${projectMembers.sharesInvested}), 0)`,
        })
        .from(projectMembers)
        .groupBy(projectMembers.projectId);

  const [allProjects, allocations] = await Promise.all([projectQuery, pmQuery]);

  const allocatedByProject = new Map(allocations.map((r) => [r.projectId, Number(r.allocated)]));

  const violations: Array<{ projectId: string; projectTitle: string; declaredTotalShares: number; memberAllocatedShares: number; overflow: number }> = [];
  for (const p of allProjects) {
    const allocated = allocatedByProject.get(p.id) ?? 0;
    if (allocated > (p.totalShares ?? 0)) {
      violations.push({
        projectId: p.id,
        projectTitle: p.title ?? '',
        declaredTotalShares: p.totalShares ?? 0,
        memberAllocatedShares: allocated,
        overflow: allocated - (p.totalShares ?? 0),
      });
    }
  }
  return violations;
}

export async function getShareConsistencyReport(tenantId?: string) {
  const db = getDb();
  
  // Scope by tenant when provided
  const memberScope = tenantId
    ? and(eq(members.status, 'active'), eq(members.tenantId, tenantId))
    : eq(members.status, 'active');

  const active = await db
    .select({
      id: members.id,
      name: members.name,
      totalContributed: members.totalContributed,
      shares: members.shares,
    })
    .from(members)
    .where(memberScope);

  // In InvestWise, member shares are fixed equity allocations assigned during onboarding
  // and modified only via explicit equity transfers or exit settlements.
  // Calculations (deposits, dividends, arrears) must NEVER alter or derive share numbers.
  // Validate that all active members have valid non-negative integer shares.
  const invalidShares: Array<{
    memberId: string;
    memberName: string;
    currentShares: number;
    issue: string;
  }> = [];

  for (const m of active) {
    const s = m.shares;
    if (s === null || s === undefined || !Number.isInteger(s) || s < 0) {
      invalidShares.push({
        memberId: m.id,
        memberName: m.name ?? '',
        currentShares: s ?? 0,
        issue: 'INVALID_SHARE_COUNT',
      });
    }
  }

  const projectOverflow = await checkProjectShareInvariants(tenantId);
  return {
    membersWithDrift: invalidShares,
    projectsWithOverflow: projectOverflow,
    overall: invalidShares.length === 0 && projectOverflow.length === 0 ? ('CONSISTENT' as const) : ('DRIFT_DETECTED' as const),
  };
}
