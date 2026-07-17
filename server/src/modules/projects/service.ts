import { getDb } from '../../config/database.js';
import * as schema from '../../db/schema/index.js';
import {
  eq, and, or, desc, asc, sql, count as drizzleCount,
  type SQL,
} from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { NotFoundError, ConflictError, LockedError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import type { z } from 'zod';
import type {
  createProjectSchema,
  updateProjectSchema,
  projectUpdateSchema,
} from './validation.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map of safe sortable columns for listProjects */
const SORT_COLUMN_MAP: Record<string, unknown> = {
  title: schema.projects.title,
  category: schema.projects.category,
  status: schema.projects.status,
  health: schema.projects.health,
  createdAt: schema.projects.createdAt,
  updatedAt: schema.projects.updatedAt,
  startDate: schema.projects.startDate,
  completionDate: schema.projects.completionDate,
  initialInvestment: schema.projects.initialInvestment,
  budget: schema.projects.budget,
  expectedRoi: schema.projects.expectedRoi,
  totalEarnings: schema.projects.totalEarnings,
  totalExpenses: schema.projects.totalExpenses,
  currentFundBalance: schema.projects.currentFundBalance,
};

/** Resolve impact sign for a project-update type. */
function getImpactSign(type: string): number {
  if (type === 'Earning' || type === 'Adjustment') return 1;
  if (type === 'Expense') return -1;
  return 0;
}

/** Compute the ownership percentage for a member. */
function calcOwnership(sharesInvested: number, totalShares: number): string {
  if (totalShares <= 0 || sharesInvested <= 0) return '0';
  return String(Math.min(((sharesInvested / totalShares) * 100), 100).toFixed(2));
}

/**
 * Recalculate project totals (totalEarnings, totalExpenses) from its
 * project_updates rows AND set currentFundBalance from the linked fund.
 */
async function syncProjectTotals(
  executor: TxOrDb,
  projectId: string,
  fundId?: string | null,
): Promise<void> {
  // -- sum earnings / expenses from project_updates --
  const [totals] = await executor
    .select({
      totalEarnings: sql<string>`COALESCE(SUM(CASE WHEN ${schema.projectUpdates.type} = 'Earning' THEN ${schema.projectUpdates.amount} ELSE 0 END), 0)`,
      totalExpenses: sql<string>`COALESCE(SUM(CASE WHEN ${schema.projectUpdates.type} = 'Expense' THEN ${schema.projectUpdates.amount} ELSE 0 END), 0)`,
    })
    .from(schema.projectUpdates)
    .where(eq(schema.projectUpdates.projectId, projectId));

  // -- current fund balance from linked fund --
  let fundBalance = '0';
  if (fundId) {
    const [fund] = await executor
      .select({ balance: schema.funds.balance })
      .from(schema.funds)
      .where(eq(schema.funds.id, fundId))
      .limit(1);
    if (fund) fundBalance = fund.balance;
  }

  await executor
    .update(schema.projects)
    .set({
      totalEarnings: totals?.totalEarnings ?? '0',
      totalExpenses: totals?.totalExpenses ?? '0',
      currentFundBalance: fundBalance,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));
}

// ---------------------------------------------------------------------------
// Query executor helper — works with both db and tx
// PgDatabase is the base class shared by PostgresJsDatabase (returned by
// getDb()) and PgTransaction (the tx argument inside db.transaction()).
// ---------------------------------------------------------------------------
type TxOrDb = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

// ---------------------------------------------------------------------------
// findPrimaryFund
// ---------------------------------------------------------------------------
async function findPrimaryFund(executor: TxOrDb, requiredAmount?: number) {
  const activeFunds = await executor
    .select()
    .from(schema.funds)
    .where(
      and(
        or(
          eq(schema.funds.type, 'PRIMARY'),
          eq(schema.funds.type, 'DEPOSIT'),
          eq(schema.funds.type, 'Primary'),
          eq(schema.funds.type, 'Reserve'),
        ),
        eq(schema.funds.status, 'ACTIVE'),
      ),
    );

  if (activeFunds.length === 0) return null;

  if (requiredAmount !== undefined) {
    // Find first fund with enough balance
    const fundWithEnoughBalance = activeFunds.find(f => Number(f.balance) >= requiredAmount);
    if (fundWithEnoughBalance) return fundWithEnoughBalance;

    // Fallback to highest balance fund so we can report the highest available in the error
    return activeFunds.reduce((max, f) => Number(f.balance) > Number(max.balance) ? f : max, activeFunds[0]);
  }

  return activeFunds[0];
}

// ---------------------------------------------------------------------------
// getProjectById (public)
// ---------------------------------------------------------------------------
export async function getProjectById(id: string) {
  const db = getDb();

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);

  if (!project) throw new NotFoundError('Project');

  const members = await db
    .select({
      projectId: schema.projectMembers.projectId,
      memberId: schema.projectMembers.memberId,
      sharesInvested: schema.projectMembers.sharesInvested,
      ownershipPercentage: schema.projectMembers.ownershipPercentage,
      member: schema.members,
    })
    .from(schema.projectMembers)
    .leftJoin(schema.members, eq(schema.projectMembers.memberId, schema.members.id))
    .where(eq(schema.projectMembers.projectId, id));

  const updates = await db
    .select()
    .from(schema.projectUpdates)
    .where(eq(schema.projectUpdates.projectId, id))
    .orderBy(desc(schema.projectUpdates.createdAt));

  return { ...project, members, updates };
}

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------
export async function listProjects(queryParams: Record<string, string | undefined>) {
  const db = getDb();
  const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(queryParams);

  const filters: SQL[] = [];

  // Full-text search across title, description, category
  const search = queryParams.search;
  if (search) {
    filters.push(
      sql`to_tsvector('english', coalesce(${schema.projects.title}, '') || ' ' || coalesce(${schema.projects.description}, '') || ' ' || coalesce(${schema.projects.category}, '')) @@ plainto_tsquery('english', ${search})`,
    );
  }

  if (queryParams.status) {
    filters.push(eq(schema.projects.status, queryParams.status));
  }
  if (queryParams.category) {
    filters.push(eq(schema.projects.category, queryParams.category));
  }
  if (queryParams.health) {
    filters.push(eq(schema.projects.health, queryParams.health));
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  // Sort (whitelist-based to prevent SQL injection)
  const sortCol = (SORT_COLUMN_MAP[sortBy] as typeof schema.projects.createdAt) ?? schema.projects.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(sortCol) : desc(sortCol);

  // Count
  const [countResult] = await db
    .select({ count: drizzleCount() })
    .from(schema.projects)
    .where(whereClause);
  const total = Number(countResult?.count ?? 0);

  // Data
  const projects = await db
    .select()
    .from(schema.projects)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(skip);

  return formatPaginatedResponse(projects, page, limit, total);
}

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------
export async function createProject(
  data: z.infer<typeof createProjectSchema>,
  user: { id: string; name: string },
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. Insert project
    const [project] = await tx
      .insert(schema.projects)
      .values({
        title: data.title,
        category: data.category,
        description: data.description,
        initialInvestment: String(data.initialInvestment),
        budget: String(data.budget),
        expectedRoi: String(data.expectedRoi),
        totalShares: data.totalShares,
        status: data.status,
        health: data.health,
        startDate: data.startDate,
        completionDate: data.completionDate ?? null,
        projectFundHandler: data.projectFundHandler ?? null,
        linkedFundId: data.linkedFundId ?? null,
      })
      .returning();

    // 2. Insert project members
    if (data.involvedMembers && data.involvedMembers.length > 0) {
      const totalShares = data.totalShares;
      await tx.insert(schema.projectMembers).values(
        data.involvedMembers.map((m) => ({
          projectId: project.id,
          memberId: m.memberId,
          sharesInvested: m.sharesInvested,
          ownershipPercentage: calcOwnership(m.sharesInvested, totalShares),
        })),
      );
    }

    // 3. Auto-create PROJECT fund if no linkedFundId
    let fundId: string | null = data.linkedFundId ?? null;
    if (!fundId) {
      const [fund] = await tx
        .insert(schema.funds)
        .values({
          name: `${data.title} Fund`,
          type: 'PROJECT',
          status: 'ACTIVE',
          linkedProjectId: project.id,
          balance: '0',
          description: `Auto-created project fund for ${data.title}`,
          handlingOfficer: data.projectFundHandler ?? null,
        })
        .returning();
      fundId = fund.id;

      await tx
        .update(schema.projects)
        .set({ linkedFundId: fundId })
        .where(eq(schema.projects.id, project.id));
    }

    // 4. Initial investment — source from primary/deposit fund
    if (data.initialInvestment > 0 && fundId) {
      const primaryFund = await findPrimaryFund(tx, data.initialInvestment);
      if (!primaryFund) {
        throw new ConflictError('No PRIMARY or DEPOSIT fund available for initial investment');
      }

      const primaryBalance = Number(primaryFund.balance);
      if (primaryBalance < data.initialInvestment) {
        throw new ConflictError(
          `Insufficient funds in primary account (available: ${primaryBalance}, required: ${data.initialInvestment})`,
        );
      }

      const newPrimaryBalance = primaryBalance - data.initialInvestment;

      // Outflow from primary fund
      await tx
        .update(schema.funds)
        .set({ balance: String(newPrimaryBalance), updatedAt: new Date() })
        .where(eq(schema.funds.id, primaryFund.id));

      // Inflow to project fund
      await tx
        .update(schema.funds)
        .set({ balance: String(data.initialInvestment), updatedAt: new Date() })
        .where(eq(schema.funds.id, fundId));

      // Outflow transaction record
      await tx.insert(schema.transactions).values({
        type: 'PROJECT_INVESTMENT',
        amount: String(data.initialInvestment),
        description: `Initial investment for project: ${data.title}`,
        category: 'Project Investment',
        status: 'Completed',
        fundId: primaryFund.id,
        projectId: project.id,
        balanceBefore: String(primaryBalance),
        balanceAfter: String(newPrimaryBalance),
        createdBy: user.id,
      });

      // Inflow transaction record
      await tx.insert(schema.transactions).values({
        type: 'PROJECT_INVESTMENT',
        amount: String(data.initialInvestment),
        description: `Initial investment received for project: ${data.title}`,
        category: 'Project Investment',
        status: 'Completed',
        fundId,
        projectId: project.id,
        balanceBefore: '0',
        balanceAfter: String(data.initialInvestment),
        createdBy: user.id,
      });
    }

    // 5. Sync project's currentFundBalance
    await syncProjectTotals(tx, project.id, fundId);

    // 6. Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      resourceType: 'Project',
      resourceId: project.id,
      details: { title: data.title, initialInvestment: data.initialInvestment },
      status: 'SUCCESS',
    });

    // 7. Re-fetch with relations before returning
    return getProjectByIdInternal(tx, project.id);
  });
}

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------
export async function updateProject(
  id: string,
  data: z.infer<typeof updateProjectSchema>,
  user: { id: string; name: string },
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Fetch existing project
    const [existing] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    if (!existing) throw new NotFoundError('Project');

    // Structural lock: if updates exist, prevent changing linkedFundId
    if (data.linkedFundId !== undefined && data.linkedFundId !== existing.linkedFundId) {
      const [updateCount] = await tx
        .select({ count: drizzleCount() })
        .from(schema.projectUpdates)
        .where(eq(schema.projectUpdates.projectId, id));
      if (Number(updateCount?.count ?? 0) > 0) {
        throw new LockedError(
          'Cannot change linked fund after project updates have been recorded',
        );
      }
    }

    // Build update payload (only set fields that are provided)
    const updatePayload: Partial<typeof schema.projects.$inferInsert> = { updatedAt: new Date() };

    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.category !== undefined) updatePayload.category = data.category;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.budget !== undefined) updatePayload.budget = String(data.budget);
    if (data.expectedRoi !== undefined) updatePayload.expectedRoi = String(data.expectedRoi);
    if (data.totalShares !== undefined) updatePayload.totalShares = data.totalShares;
    if (data.status !== undefined) updatePayload.status = data.status;
    if (data.health !== undefined) updatePayload.health = data.health;
    if (data.startDate !== undefined) updatePayload.startDate = data.startDate;
    if (data.completionDate !== undefined) updatePayload.completionDate = data.completionDate ?? null;
    if (data.projectFundHandler !== undefined) updatePayload.projectFundHandler = data.projectFundHandler ?? null;
    if (data.linkedFundId !== undefined) updatePayload.linkedFundId = data.linkedFundId ?? null;

    // Handle initialInvestment delta
    if (data.initialInvestment !== undefined && data.initialInvestment !== Number(existing.initialInvestment)) {
      const oldInvestment = Number(existing.initialInvestment);
      const newInvestment = data.initialInvestment;
      const delta = newInvestment - oldInvestment;
      updatePayload.initialInvestment = String(newInvestment);

      if (delta !== 0 && existing.linkedFundId) {
        // Adjust primary fund
        const primaryFund = await findPrimaryFund(tx, delta > 0 ? delta : undefined);
        if (!primaryFund) {
          throw new ConflictError('No PRIMARY or DEPOSIT fund available for balance adjustment');
        }

        const primaryBalance = Number(primaryFund.balance);
        const projectFundBalance = Number(existing.currentFundBalance ?? 0);

        if (delta > 0 && primaryBalance < delta) {
          throw new ConflictError(
            `Insufficient primary fund balance (${primaryBalance}) for additional investment of ${delta}`,
          );
        }

        const newPrimaryBalance = delta > 0
          ? primaryBalance - delta
          : primaryBalance + Math.abs(delta);
        const newProjectFundBalance = projectFundBalance + delta;

        // Update primary fund
        await tx
          .update(schema.funds)
          .set({ balance: String(newPrimaryBalance), updatedAt: new Date() })
          .where(eq(schema.funds.id, primaryFund.id));

        // Update project fund
        await tx
          .update(schema.funds)
          .set({ balance: String(newProjectFundBalance), updatedAt: new Date() })
          .where(eq(schema.funds.id, existing.linkedFundId));

        // Transaction record
        await tx.insert(schema.transactions).values({
          type: delta > 0 ? 'PROJECT_INVESTMENT' : 'PROJECT_WITHDRAWAL',
          amount: String(Math.abs(delta)),
          description: `Investment adjustment for project: ${existing.title} (${delta > 0 ? 'increase' : 'decrease'})`,
          category: 'Project Investment Adjustment',
          status: 'Completed',
          fundId: existing.linkedFundId,
          projectId: id,
          balanceBefore: String(projectFundBalance),
          balanceAfter: String(newProjectFundBalance),
          createdBy: user.id,
        });
      }
    }

    // Apply update
    await tx
      .update(schema.projects)
      .set(updatePayload)
      .where(eq(schema.projects.id, id));

    // Handle members replacement
    if (data.involvedMembers !== undefined) {
      await tx
        .delete(schema.projectMembers)
        .where(eq(schema.projectMembers.projectId, id));

      if (data.involvedMembers.length > 0) {
        const totalShares = data.totalShares ?? Number(existing.totalShares);
        await tx.insert(schema.projectMembers).values(
          data.involvedMembers.map((m) => ({
            projectId: id,
            memberId: m.memberId,
            sharesInvested: m.sharesInvested,
            ownershipPercentage: calcOwnership(m.sharesInvested, totalShares),
          })),
        );
      }
    }

    // Sync totals
    const effectiveFundId = data.linkedFundId !== undefined
      ? (data.linkedFundId ?? null)
      : existing.linkedFundId;
    await syncProjectTotals(tx, id, effectiveFundId);

    // Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: { title: existing.title, changes: Object.keys(updatePayload) },
      status: 'SUCCESS',
    });

    return getProjectByIdInternal(tx, id);
  });
}

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------
export async function deleteProject(
  id: string,
  user: { id: string; name: string },
): Promise<{ id: string; title: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);
    if (!project) throw new NotFoundError('Project');

    // If linked fund exists, revert its liquidity to primary fund
    if (project.linkedFundId) {
      const [fund] = await tx
        .select()
        .from(schema.funds)
        .where(eq(schema.funds.id, project.linkedFundId))
        .limit(1);

      if (fund) {
        const fundBalance = Number(fund.balance);
        if (fundBalance > 0) {
          const primaryFund = await findPrimaryFund(tx);
          if (primaryFund) {
            const newPrimaryBalance = Number(primaryFund.balance) + fundBalance;

            // Transfer back to primary
            await tx
              .update(schema.funds)
              .set({ balance: String(newPrimaryBalance), updatedAt: new Date() })
              .where(eq(schema.funds.id, primaryFund.id));

            // Zero out project fund
            await tx
              .update(schema.funds)
              .set({ balance: '0', updatedAt: new Date() })
              .where(eq(schema.funds.id, project.linkedFundId));

            // Reversal transaction
            await tx.insert(schema.transactions).values({
              type: 'FUND_REVERSAL',
              amount: String(fundBalance),
              description: `Reversal of project fund balance for deleted project: ${project.title}`,
              category: 'Project Termination',
              status: 'Completed',
              fundId: project.linkedFundId,
              projectId: id,
              balanceBefore: String(fundBalance),
              balanceAfter: '0',
              createdBy: user.id,
            });
          }
        }

        // Soft-close fund
        await tx
          .update(schema.funds)
          .set({ status: 'CLOSED', updatedAt: new Date() })
          .where(eq(schema.funds.id, project.linkedFundId));
      }
    }

    // Soft-delete linked transactions (disconnect project FK to allow hard delete)
    await tx
      .update(schema.transactions)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: user.id,
        deletionReason: `Project deleted: ${project.title}`,
        projectId: null, // release FK so we can delete the project
      })
      .where(eq(schema.transactions.projectId, id));

    // Hard delete project (CASCADE removes projectUpdates & projectMembers)
    await tx.delete(schema.projects).where(eq(schema.projects.id, id));

    // Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      resourceType: 'Project',
      resourceId: id,
      details: { title: project.title },
      status: 'SUCCESS',
    });

    return { id: project.id, title: project.title };
  });
}

// ---------------------------------------------------------------------------
// addProjectUpdate
// ---------------------------------------------------------------------------
export async function addProjectUpdate(
  projectId: string,
  data: z.infer<typeof projectUpdateSchema>,
  user: { id: string; name: string },
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundError('Project');

    const sign = getImpactSign(data.type);
    const amountNum = data.amount;

    // Determine current fund balance for this project
    let balanceBefore = Number(project.currentFundBalance ?? 0);
    let fundId: string | null = project.linkedFundId;

    if (fundId) {
      const [fund] = await tx
        .select({ balance: schema.funds.balance })
        .from(schema.funds)
        .where(eq(schema.funds.id, fundId))
        .limit(1);
      if (fund) balanceBefore = Number(fund.balance);
    }

    const balanceAfter = Math.max(balanceBefore + sign * amountNum, 0);

    // Insert update record
    const [updateRecord] = await tx
      .insert(schema.projectUpdates)
      .values({
        projectId,
        type: data.type,
        amount: String(amountNum),
        description: data.description,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        ...(data.date ? { date: new Date(data.date) } : {}),
      })
      .returning();

    // Adjust fund balance
    if (fundId) {
      await tx
        .update(schema.funds)
        .set({ balance: String(balanceAfter), updatedAt: new Date() })
        .where(eq(schema.funds.id, fundId));

      // Transaction record
      await tx.insert(schema.transactions).values({
        type: data.type === 'Earning' ? 'PROJECT_EARNING' : data.type === 'Expense' ? 'PROJECT_EXPENSE' : 'PROJECT_ADJUSTMENT',
        amount: String(amountNum),
        description: data.description,
        category: `Project ${data.type}`,
        status: 'Completed',
        fundId,
        projectId,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
        createdBy: user.id,
      });
    }

    // Sync project totals
    await syncProjectTotals(tx, projectId, fundId);

    // Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      resourceType: 'ProjectUpdate',
      resourceId: updateRecord.id,
      details: {
        projectId,
        projectTitle: project.title,
        type: data.type,
        amount: amountNum,
      },
      status: 'SUCCESS',
    });

    return updateRecord;
  });
}

// ---------------------------------------------------------------------------
// editProjectUpdate
// ---------------------------------------------------------------------------
export async function editProjectUpdate(
  projectId: string,
  updateId: string,
  data: z.infer<typeof projectUpdateSchema>,
  user: { id: string; name: string },
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Fetch project
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundError('Project');

    // Fetch existing update
    const [existingUpdate] = await tx
      .select()
      .from(schema.projectUpdates)
      .where(
        and(
          eq(schema.projectUpdates.id, updateId),
          eq(schema.projectUpdates.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existingUpdate) throw new NotFoundError('Project update');

    // Compute impact delta
    const oldImpact = getImpactSign(existingUpdate.type) * Number(existingUpdate.amount);
    const newImpact = getImpactSign(data.type) * data.amount;
    const delta = newImpact - oldImpact;

    // Get current fund balance
    let fundId = project.linkedFundId;
    let balanceBefore = Number(project.currentFundBalance ?? 0);
    if (fundId) {
      const [fund] = await tx
        .select({ balance: schema.funds.balance })
        .from(schema.funds)
        .where(eq(schema.funds.id, fundId))
        .limit(1);
      if (fund) balanceBefore = Number(fund.balance);
    }

    // The balance before (from the fund perspective) is current. The
    // "balance before" recorded on the update entry is the fund balance
    // *before* this specific edit is applied, after reversing the old impact.
    const preEditBalance = balanceBefore - oldImpact; // reverse old impact first
    const postEditBalance = Math.max(preEditBalance + newImpact, 0);

    // Update the record
    const updatePayload: Partial<typeof schema.projectUpdates.$inferInsert> = {
      type: data.type,
      amount: String(data.amount),
      description: data.description,
      balanceBefore: String(preEditBalance),
      balanceAfter: String(postEditBalance),
    };
    if (data.date) updatePayload.date = new Date(data.date);

    await tx
      .update(schema.projectUpdates)
      .set(updatePayload)
      .where(eq(schema.projectUpdates.id, updateId));

    // Adjust fund balance
    if (fundId) {
      // Net change to apply on top of the current fund balance
      const newFundBalance = Math.max(balanceBefore + delta, 0);
      await tx
        .update(schema.funds)
        .set({ balance: String(newFundBalance), updatedAt: new Date() })
        .where(eq(schema.funds.id, fundId));

      // Reversal / correction transaction
      await tx.insert(schema.transactions).values({
        type: 'PROJECT_UPDATE_CORRECTION',
        amount: String(Math.abs(delta)),
        description: `Update correction: ${existingUpdate.description} -> ${data.description}`,
        category: 'Project Update Correction',
        status: 'Completed',
        fundId,
        projectId,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(newFundBalance),
        createdBy: user.id,
      });
    }

    // Sync totals
    await syncProjectTotals(tx, projectId, fundId);

    // Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      resourceType: 'ProjectUpdate',
      resourceId: updateId,
      details: {
        projectId,
        projectTitle: project.title,
        oldType: existingUpdate.type,
        oldAmount: existingUpdate.amount,
        newType: data.type,
        newAmount: data.amount,
      },
      status: 'SUCCESS',
    });

    // Return updated record
    const [updated] = await tx
      .select()
      .from(schema.projectUpdates)
      .where(eq(schema.projectUpdates.id, updateId))
      .limit(1);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// deleteProjectUpdate
// ---------------------------------------------------------------------------
export async function deleteProjectUpdate(
  projectId: string,
  updateId: string,
  user: { id: string; name: string },
): Promise<{ id: string }> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundError('Project');

    const [update] = await tx
      .select()
      .from(schema.projectUpdates)
      .where(
        and(
          eq(schema.projectUpdates.id, updateId),
          eq(schema.projectUpdates.projectId, projectId),
        ),
      )
      .limit(1);
    if (!update) throw new NotFoundError('Project update');

    // Reverse impact on fund balance
    const impact = getImpactSign(update.type) * Number(update.amount);
    const fundId = project.linkedFundId;

    if (fundId && impact !== 0) {
      let fundBalance = Number(project.currentFundBalance ?? 0);
      const [fund] = await tx
        .select({ balance: schema.funds.balance })
        .from(schema.funds)
        .where(eq(schema.funds.id, fundId))
        .limit(1);
      if (fund) fundBalance = Number(fund.balance);

      const newBalance = Math.max(fundBalance - impact, 0);
      await tx
        .update(schema.funds)
        .set({ balance: String(newBalance), updatedAt: new Date() })
        .where(eq(schema.funds.id, fundId));

      // Reversal transaction
      await tx.insert(schema.transactions).values({
        type: 'PROJECT_UPDATE_REVERSAL',
        amount: String(Number(update.amount)),
        description: `Reversal of deleted update: ${update.description}`,
        category: 'Project Update Reversal',
        status: 'Completed',
        fundId,
        projectId,
        balanceBefore: String(fundBalance),
        balanceAfter: String(newBalance),
        createdBy: user.id,
      });
    }

    // Delete the update record
    await tx
      .delete(schema.projectUpdates)
      .where(eq(schema.projectUpdates.id, updateId));

    // Sync totals
    await syncProjectTotals(tx, projectId, fundId);

    // Audit
    await tx.insert(schema.auditLogs).values({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      resourceType: 'ProjectUpdate',
      resourceId: updateId,
      details: {
        projectId,
        projectTitle: project.title,
        type: update.type,
        amount: update.amount,
        description: update.description,
      },
      status: 'SUCCESS',
    });

    return { id: updateId };
  });
}

// ---------------------------------------------------------------------------
// Internal getProjectById — uses the executor (db or tx) passed in
// ---------------------------------------------------------------------------
async function getProjectByIdInternal(executor: TxOrDb, id: string) {
  const [project] = await executor
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);

  if (!project) throw new NotFoundError('Project');

  const members = await executor
    .select({
      projectId: schema.projectMembers.projectId,
      memberId: schema.projectMembers.memberId,
      sharesInvested: schema.projectMembers.sharesInvested,
      ownershipPercentage: schema.projectMembers.ownershipPercentage,
      member: schema.members,
    })
    .from(schema.projectMembers)
    .leftJoin(schema.members, eq(schema.projectMembers.memberId, schema.members.id))
    .where(eq(schema.projectMembers.projectId, id));

  const updates = await executor
    .select()
    .from(schema.projectUpdates)
    .where(eq(schema.projectUpdates.projectId, id))
    .orderBy(desc(schema.projectUpdates.createdAt));

  return { ...project, members, updates };
}
