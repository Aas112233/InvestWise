import { getDb } from '../../config/database.js';
import { members, projects, projectMembers, systemSettings } from '../../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';

export async function recalculateAllMemberShares(): Promise<{ updated: number }> {
  const db = getDb();
  const [settings] = await db.select().from(systemSettings).limit(1);
  const shareValue = Number(settings?.shareValueBdt ?? 1000);
  if (shareValue <= 0) return { updated: 0 };
  const all = await db.select({ id: members.id, totalContributed: members.totalContributed, shares: members.shares }).from(members).where(eq(members.status, 'active'));
  let updated = 0;
  for (const m of all) {
    const derived = Math.floor(Number(m.totalContributed ?? 0) / shareValue);
    if (derived !== (m.shares ?? 0)) {
      await db.update(members).set({ shares: derived, updatedAt: new Date() }).where(eq(members.id, m.id));
      updated++;
    }
  }
  return { updated };
}

export async function checkProjectShareInvariants() {
  const db = getDb();
  const allProjects = await db.select({ id: projects.id, title: projects.title, totalShares: projects.totalShares }).from(projects);
  const violations: Array<{ projectId: string; projectTitle: string; declaredTotalShares: number; memberAllocatedShares: number; overflow: number }> = [];
  for (const p of allProjects) {
    const [agg] = await db.select({ total: sql<number>`COALESCE(SUM(${projectMembers.sharesInvested}), 0)` }).from(projectMembers).where(eq(projectMembers.projectId, p.id));
    const allocated = agg?.total ?? 0;
    if (allocated > (p.totalShares ?? 0)) violations.push({ projectId: p.id, projectTitle: p.title ?? '', declaredTotalShares: p.totalShares ?? 0, memberAllocatedShares: allocated, overflow: allocated - (p.totalShares ?? 0) });
  }
  return violations;
}

export async function getShareConsistencyReport() {
  const db = getDb();
  const [settings] = await db.select().from(systemSettings).limit(1);
  const shareValue = Number(settings?.shareValueBdt ?? 1000);
  const active = await db.select({ id: members.id, name: members.name, totalContributed: members.totalContributed, shares: members.shares }).from(members).where(eq(members.status, 'active'));
  const drift: Array<{ memberId: string; memberName: string; currentShares: number; derivedShares: number; contributed: number; shareValue: number; drift: number }> = [];
  for (const m of active) {
    const derived = shareValue > 0 ? Math.floor(Number(m.totalContributed ?? 0) / shareValue) : 0;
    if (derived !== (m.shares ?? 0)) drift.push({ memberId: m.id, memberName: m.name ?? '', currentShares: m.shares ?? 0, derivedShares: derived, contributed: Number(m.totalContributed ?? 0), shareValue, drift: derived - (m.shares ?? 0) });
  }
  const projectOverflow = await checkProjectShareInvariants();
  return { membersWithDrift: drift, projectsWithOverflow: projectOverflow, overall: drift.length === 0 && projectOverflow.length === 0 ? 'CONSISTENT' as const : 'DRIFT_DETECTED' as const };
}
