import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import {
  projects,
  projectUpdates,
  projectMembers,
  funds,
  transactions,
  auditLogs,
  systemSettings,
} from '../db/schema/index.js';
import {
  eq,
  and,
  or,
  desc,
  count,
  ilike,
  gte,
  inArray,
} from 'drizzle-orm';
import { logAudit } from '../utils/auditLogger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { queueStatsRecalculation } from './analyticsController.js';
import { normalizeCurrencyCode, formatMoney } from '../utils/currency.js';
import cache from '../utils/cache.js';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
interface AuthUser {
  _id: string;
  name?: string;
}

const getReqUser = (req: any): AuthUser | null => {
  if (!req?.user) return null;
  return { _id: String(req.user._id), name: req.user.name };
};

const safeStr = (v: unknown): string => String(v ?? '');

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
const getProjects = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(req.query);
  const search = safeStr(req.query.search);

  const whereClause = search
    ? or(
        ilike(projects.title, `%${search}%`),
        ilike(projects.category, `%${search}%`),
      )
    : undefined;

  const [{ count: total }] = await db
    .select({ count: count() })
    .from(projects)
    .where(whereClause);

  const projectList = await db
    .select()
    .from(projects)
    .where(whereClause)
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(skip);

  res.json(formatPaginatedResponse(projectList, page, limit, Number(total)));
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------
const getProjectById = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id));

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  const [updates, members] = await Promise.all([
    db
      .select()
      .from(projectUpdates)
      .where(eq(projectUpdates.projectId, id))
      .orderBy(projectUpdates.date),
    db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, id)),
  ]);

  res.json({
    ...project,
    updates,
    involvedMembers: members,
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------
const createProject = asyncHandler(async (req, res) => {
  const db = getDb();
  const {
    title,
    category,
    description,
    initialInvestment,
    budget,
    expectedRoi,
    totalShares,
    startDate,
    completionDate,
    involvedMembers,
    projectFundHandler,
  } = req.body;

  const project = await db.transaction(async (tx) => {
    // --- settings ----------------------------------------------------------
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const currencyCode = normalizeCurrencyCode(settings?.baseCurrency);

    // --- process members ---------------------------------------------------
    const processedMembers = (involvedMembers || []).map((m: any) => ({
      memberId: m.memberId || m.member,
      sharesInvested: Number(m.sharesInvested) || 0,
      ownershipPercentage:
        Number(totalShares) > 0
          ? String(((Number(m.sharesInvested) || 0) / Number(totalShares)) * 100)
          : '0',
    }));

    // 1. Create the project
    const [project] = await tx
      .insert(projects)
      .values({
        title,
        category,
        description,
        initialInvestment: String(initialInvestment || 0),
        budget: String(budget || initialInvestment || 0),
        expectedRoi: String(expectedRoi || 0),
        totalShares: Number(totalShares) || 0,
        startDate: startDate ? new Date(startDate) : new Date(),
        completionDate: completionDate ? new Date(completionDate) : null,
        projectFundHandler: projectFundHandler || null,
        currentFundBalance: String(initialInvestment || 0),
      })
      .returning();

    // 2. Insert project members
    if (processedMembers.length > 0) {
      await tx.insert(projectMembers).values(
        processedMembers.map((m: any) => ({
          projectId: project.id,
          memberId: m.memberId,
          sharesInvested: m.sharesInvested,
          ownershipPercentage: m.ownershipPercentage,
        })),
      );
    }

    // 3. Create the auto-generated fund
    const [fund] = await tx
      .insert(funds)
      .values({
        name: `${title} Fund`,
        type: 'PROJECT',
        status: 'ACTIVE',
        currency: currencyCode,
        linkedProjectId: project.id,
        balance: '0',
        description: `Auto-generated fund for project: ${title}`,
      })
      .returning();

    // Link project ↔ fund
    await tx
      .update(projects)
      .set({ linkedFundId: fund.id })
      .where(eq(projects.id, project.id));

    // 4. Handle initial investment funding
    if (Number(initialInvestment) > 0) {
      const [sourceFund] = await tx
        .select()
        .from(funds)
        .where(
          and(
            inArray(funds.type, ['Primary', 'DEPOSIT']),
            eq(funds.status, 'ACTIVE'),
            gte(funds.balance, String(initialInvestment)),
          ),
        )
        .limit(1);

      if (!sourceFund) {
        const [bestFund] = await tx
          .select()
          .from(funds)
          .where(
            and(
              inArray(funds.type, ['Primary', 'DEPOSIT']),
              eq(funds.status, 'ACTIVE'),
            ),
          )
          .orderBy(desc(funds.balance))
          .limit(1);

        if (!bestFund) {
          throw new Error(
            'No Active Primary/Deposit Fund found to source the initial investment.',
          );
        }
        throw new Error(
          `Project Authorization Failed: Insufficient liquidity in enterprise reserves. Required: ${formatMoney(Number(initialInvestment), currencyCode)}, Highest available fund (${bestFund.name}) only has ${formatMoney(Number(bestFund.balance), currencyCode)}.`,
        );
      }

      // Debit source – Credit project fund
      await tx
        .update(funds)
        .set({ balance: String(Number(sourceFund.balance) - Number(initialInvestment)) })
        .where(eq(funds.id, sourceFund.id));

      await tx
        .update(funds)
        .set({ balance: String(Number(initialInvestment)) })
        .where(eq(funds.id, fund.id));

      // Record audit transactions
      const authUser = getReqUser(req);
      await tx.insert(transactions).values([
        {
          type: 'Investment',
          amount: String(Number(initialInvestment)),
          description: `Project Funding Received: ${title}`,
          fundId: fund.id,
          projectId: project.id,
          authorizedBy: authUser?._id ?? null,
          date: startDate ? new Date(startDate) : new Date(),
        },
        {
          type: 'Withdrawal',
          amount: String(Number(initialInvestment)),
          description: `Investment Sent to Project: ${title}`,
          fundId: sourceFund.id,
          projectId: project.id,
          authorizedBy: authUser?._id ?? null,
          date: startDate ? new Date(startDate) : new Date(),
        },
      ]);
    }

    return project;
  });

  queueStatsRecalculation();
  cache.invalidateByPrefix('projects:');
  res.status(201).json(project);
});

// ---------------------------------------------------------------------------
// PUT /api/projects/:id
// ---------------------------------------------------------------------------
const updateProject = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;
  const {
    title,
    category,
    description,
    initialInvestment,
    budget,
    expectedRoi,
    totalShares,
    startDate,
    completionDate,
    involvedMembers,
    projectFundHandler,
    status,
    health,
  } = req.body;

  const updatedProject = await db.transaction(async (tx) => {
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const currencyCode = normalizeCurrencyCode(settings?.baseCurrency);

    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      res.status(404);
      throw new Error('Project not found');
    }

    // Structural lock – cannot edit if operational updates exist
    const [updCount] = await tx
      .select({ count: count() })
      .from(projectUpdates)
      .where(eq(projectUpdates.projectId, id));

    const updateCount = Number(updCount.count);
    if (updateCount > 0) {
      throw new Error(
        `Modification Restricted: This project has ${updateCount} active operational records. These must be purged or reconciled before structural changes are allowed.`,
      );
    }

    // Process members
    const processedMembers = (involvedMembers || []).map((m: any) => ({
      memberId: m.memberId || m.member,
      sharesInvested: Number(m.sharesInvested) || 0,
      ownershipPercentage:
        Number(totalShares) > 0
          ? String(((Number(m.sharesInvested) || 0) / Number(totalShares)) * 100)
          : '0',
    }));

    const oldInitialInvestment = Number(project.initialInvestment) || 0;
    const newInitialInvestment =
      initialInvestment !== undefined ? Number(initialInvestment) : oldInitialInvestment;

    // Build update payload
    const updateData: Record<string, any> = {};
    if (title) updateData.title = title;
    if (category) updateData.category = category;
    if (description) updateData.description = description;
    if (budget !== undefined) updateData.budget = String(budget);
    if (expectedRoi !== undefined) updateData.expectedRoi = String(expectedRoi);
    if (totalShares !== undefined) updateData.totalShares = Number(totalShares);
    if (startDate) updateData.startDate = new Date(startDate);
    if (completionDate !== undefined) updateData.completionDate = completionDate ? new Date(completionDate) : null;
    if (projectFundHandler) updateData.projectFundHandler = projectFundHandler;
    if (status) updateData.status = status;
    if (health) updateData.health = health;
    updateData.initialInvestment = String(newInitialInvestment);
    updateData.currentFundBalance = String(Number(project.currentFundBalance) || 0);

    // Re-involved members (delete + re-insert)
    if (processedMembers.length > 0) {
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      await tx.insert(projectMembers).values(
        processedMembers.map((m: any) => ({
          projectId: id,
          memberId: m.memberId,
          sharesInvested: m.sharesInvested,
          ownershipPercentage: m.ownershipPercentage,
        })),
      );
    }

    // Fund adjustments
    const authUser = getReqUser(req);

    if (newInitialInvestment !== oldInitialInvestment) {
      const delta = newInitialInvestment - oldInitialInvestment;

      const [projectFund] = await tx
        .select()
        .from(funds)
        .where(eq(funds.id, project.linkedFundId));

      if (!projectFund) throw new Error('Associated Project Fund not found.');

      if (delta > 0) {
        // --- Need more funds from enterprise reserves -----------------------
        const [sourceFund] = await tx
          .select()
          .from(funds)
          .where(
            and(
              inArray(funds.type, ['Primary', 'DEPOSIT']),
              eq(funds.status, 'ACTIVE'),
              gte(funds.balance, String(delta)),
            ),
          )
          .limit(1);

        if (!sourceFund) {
          const [bestFund] = await tx
            .select()
            .from(funds)
            .where(
              and(
                inArray(funds.type, ['Primary', 'DEPOSIT']),
                eq(funds.status, 'ACTIVE'),
              ),
            )
            .orderBy(desc(funds.balance))
            .limit(1);

          throw new Error(
            `Insufficient liquidity in enterprise reserves. Required additional: ${formatMoney(delta, currencyCode)}. Highest available fund (${bestFund?.name || 'N/A'}) only has ${formatMoney(Number(bestFund?.balance || 0), currencyCode)}.`,
          );
        }

        const projectNewBal = Number(projectFund.balance) + delta;
        const sourceNewBal = Number(sourceFund.balance) - delta;
        const projectCurrentFundBal = (Number(updateData.currentFundBalance) || 0) + delta;

        await tx
          .update(funds)
          .set({ balance: String(sourceNewBal) })
          .where(eq(funds.id, sourceFund.id));

        await tx
          .update(funds)
          .set({ balance: String(projectNewBal) })
          .where(eq(funds.id, projectFund.id));

        updateData.currentFundBalance = String(projectCurrentFundBal);

        await tx.insert(transactions).values([
          {
            type: 'Investment',
            amount: String(delta),
            description: `Project Funding Increased: ${project.title}`,
            fundId: projectFund.id,
            projectId: id,
            authorizedBy: authUser?._id ?? null,
            date: new Date(),
          },
          {
            type: 'Withdrawal',
            amount: String(delta),
            description: `Additional Investment to Project: ${project.title}`,
            fundId: sourceFund.id,
            projectId: id,
            authorizedBy: authUser?._id ?? null,
            date: new Date(),
          },
        ]);
      } else if (delta < 0) {
        // --- Partial divestment / fund recovery ----------------------------
        const refundAmount = Math.abs(delta);

        if (Number(projectFund.balance) < refundAmount) {
          throw new Error(
            `Divestment Failed: Project fund only has ${formatMoney(Number(projectFund.balance), currencyCode)} available liquidity. To reduce initial investment by ${formatMoney(refundAmount, currencyCode)}, you must first recover project liquidity.`,
          );
        }

        // Find the original source fund
        const [originalInvestmentTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.projectId, id),
              eq(transactions.type, 'Withdrawal'),
            ),
          )
          .orderBy(transactions.date)
          .limit(1);

        let targetFund;
        if (originalInvestmentTx) {
          const [tf] = await tx
            .select()
            .from(funds)
            .where(eq(funds.id, originalInvestmentTx.fundId));
          targetFund = tf;
        }
        if (!targetFund) {
          const [tf] = await tx
            .select()
            .from(funds)
            .where(
              and(
                inArray(funds.type, ['Primary', 'DEPOSIT']),
                eq(funds.status, 'ACTIVE'),
              ),
            )
            .limit(1);
          targetFund = tf;
        }
        if (!targetFund) throw new Error('No target Primary/Deposit fund found to receive refund.');

        const projectNewBal = Number(projectFund.balance) - refundAmount;
        const targetNewBal = Number(targetFund.balance) + refundAmount;
        const projectCurrentFundBal = (Number(updateData.currentFundBalance) || 0) - refundAmount;

        await tx
          .update(funds)
          .set({ balance: String(projectNewBal) })
          .where(eq(funds.id, projectFund.id));

        await tx
          .update(funds)
          .set({ balance: String(targetNewBal) })
          .where(eq(funds.id, targetFund.id));

        updateData.currentFundBalance = String(projectCurrentFundBal);

        await tx.insert(transactions).values([
          {
            type: 'Withdrawal',
            amount: String(refundAmount),
            description: `Project Funding Reduced: ${project.title}`,
            fundId: projectFund.id,
            projectId: id,
            authorizedBy: authUser?._id ?? null,
            date: new Date(),
          },
          {
            type: 'Investment',
            amount: String(refundAmount),
            description: `Investment Refund from Project: ${project.title}`,
            fundId: targetFund.id,
            projectId: id,
            authorizedBy: authUser?._id ?? null,
            date: new Date(),
          },
        ]);
      }
    }

    // Persist project updates
    await tx
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id));

    // Re-fetch for response
    const [updatedProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    return updatedProject;
  });

  queueStatsRecalculation();
  cache.invalidateByPrefix('projects:');

  logAudit({
    req: req as any,
    user: getReqUser(req),
    action: 'UPDATE_PROJECT',
    resourceType: 'Project',
    resourceId: id,
    details: { title: updatedProject.title, changes: req.body },
  });

  res.json(updatedProject);
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
// ---------------------------------------------------------------------------
const deleteProject = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id));

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  // Termination lock
  const [updCount] = await db
    .select({ count: count() })
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, id));

  if (Number(updCount.count) > 0) {
    throw new Error(
      `Termination Forbidden: Project "${project.title}" has active operational records. These must be purged or reconciled individually before the project can be terminated.`,
    );
  }

  await db.transaction(async (tx) => {
    // 1. Revert liquidity
    const [projectFund] = await tx
      .select()
      .from(funds)
      .where(eq(funds.id, project.linkedFundId));

    const amountToRevert = projectFund
      ? Number(projectFund.balance)
      : Number(project.initialInvestment) || 0;

    if (amountToRevert > 0) {
      const [enterpriseFund] = await tx
        .select()
        .from(funds)
        .where(
          and(
            inArray(funds.type, ['Primary', 'DEPOSIT']),
            eq(funds.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (enterpriseFund) {
        const authUser = getReqUser(req);
        await tx
          .update(funds)
          .set({ balance: String(Number(enterpriseFund.balance) + amountToRevert) })
          .where(eq(funds.id, enterpriseFund.id));

        await tx.insert(transactions).values({
          type: 'Investment',
          amount: String(amountToRevert),
          description: `Project Liquidation: Funds returned from ${project.title}`,
          fundId: enterpriseFund.id,
          authorizedBy: authUser?._id ?? null,
          date: new Date(),
        });
      }
    }

    // 2. Soft-delete associated transactions
    await tx
      .update(transactions)
      .set({ isDeleted: true, status: 'Cancelled' })
      .where(eq(transactions.projectId, id));

    // 3. Archive project fund
    if (project.linkedFundId) {
      await tx
        .update(funds)
        .set({ status: 'ARCHIVED' })
        .where(eq(funds.id, project.linkedFundId));
    }

    // 4. Delete project members & updates, then the project itself
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await tx.delete(projectUpdates).where(eq(projectUpdates.projectId, id));
    await tx.delete(projects).where(eq(projects.id, id));
  });

  queueStatsRecalculation();

  logAudit({
    req: req as any,
    user: getReqUser(req),
    action: 'DELETE_PROJECT',
    resourceType: 'Project',
    resourceId: id,
    details: { title: project.title, finalBalanceReverted: Number(project.initialInvestment) || 0 },
  });

  res.json({
    message: 'Project terminated successfully. All liquidity has been reconciled to enterprise reserves.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/updates — add an earning / expense record
// ---------------------------------------------------------------------------
const addProjectUpdate = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;
  const { type, amount, description, date } = req.body;

  const fullProject = await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      res.status(404);
      throw new Error('Project not found');
    }

    const updateDate = date ? new Date(date) : new Date();
    const updateAmount = Number(amount);
    const balanceBefore = Number(project.currentFundBalance) || 0;
    let balanceAfter = balanceBefore;

    if (type === 'Earning') {
      balanceAfter += updateAmount;
    } else if (type === 'Expense') {
      balanceAfter -= updateAmount;
    }

    // 1. Insert the update record
    await tx
      .insert(projectUpdates)
      .values({
        projectId: id,
        type,
        amount: String(updateAmount),
        description,
        date: updateDate,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
      })
      .returning();

    // 2. Update project totals
    const newTotalEarnings = (Number(project.totalEarnings) || 0) + (type === 'Earning' ? updateAmount : 0);
    const newTotalExpenses = (Number(project.totalExpenses) || 0) + (type === 'Expense' ? updateAmount : 0);

    await tx
      .update(projects)
      .set({
        currentFundBalance: String(balanceAfter),
        totalEarnings: String(newTotalEarnings),
        totalExpenses: String(newTotalExpenses),
      })
      .where(eq(projects.id, id));

    // 3. Update associated fund balance
    if (project.linkedFundId) {
      const [fund] = await tx
        .select()
        .from(funds)
        .where(eq(funds.id, project.linkedFundId));

      if (fund) {
        let fundBal = Number(fund.balance);
        if (type === 'Earning') fundBal += updateAmount;
        else if (type === 'Expense') fundBal -= updateAmount;

        await tx
          .update(funds)
          .set({ balance: String(fundBal) })
          .where(eq(funds.id, project.linkedFundId));
      }
    }

    // 4. Record audit transaction
    const authUser = getReqUser(req);
    await tx.insert(transactions).values({
      type,
      amount: String(updateAmount),
      description: `[Project Update: ${project.title}] ${description}`,
      projectId: id,
      fundId: project.linkedFundId,
      date: updateDate,
      status: 'Completed',
      authorizedBy: authUser?._id ?? null,
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
    });

    // 5. System audit log
    await tx.insert(auditLogs).values({
      user: authUser?._id ?? null,
      userName: authUser?.name ?? 'System',
      action: 'ADD_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: {
        message: `Added ${type.toLowerCase()} of ${updateAmount} to project ${project.title}`,
        type,
        amount: updateAmount,
        description,
      },
      ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    // Re-fetch the full project
    const [fullProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    return fullProject;
  });

  queueStatsRecalculation();
  cache.invalidateByPrefix('projects:');

  const updates = await db
    .select()
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, id))
    .orderBy(projectUpdates.date);

  const members = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, id));

  res.status(201).json({
    ...fullProject,
    updates,
    involvedMembers: members,
  });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/:id/updates/:updateId — edit an update record
// ---------------------------------------------------------------------------
const editProjectUpdate = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;
  const updateId = req.params.updateId as string;
  const { type, amount, description, date } = req.body;

  const fullProject = await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      res.status(404);
      throw new Error('Project not found');
    }

    const [update] = await tx
      .select()
      .from(projectUpdates)
      .where(eq(projectUpdates.id, updateId));

    if (!update) {
      res.status(404);
      throw new Error('Update record not found');
    }

    const oldType = update.type;
    const oldAmount = Number(update.amount);
    const newAmount = Number(amount);

    // 1. Revert old impact on project totals
    let currentBal = Number(project.currentFundBalance) || 0;
    let totalEarnings = Number(project.totalEarnings) || 0;
    let totalExpenses = Number(project.totalExpenses) || 0;

    if (oldType === 'Earning') {
      currentBal -= oldAmount;
      totalEarnings -= oldAmount;
    } else if (oldType === 'Expense') {
      currentBal += oldAmount;
      totalExpenses -= oldAmount;
    }

    // 2. Apply new impact
    if (type === 'Earning') {
      currentBal += newAmount;
      totalEarnings += newAmount;
    } else if (type === 'Expense') {
      currentBal -= newAmount;
      totalExpenses += newAmount;
    }

    // 3. Update the update record
    await tx
      .update(projectUpdates)
      .set({
        type,
        amount: String(newAmount),
        description: description || update.description,
        date: date ? new Date(date) : update.date,
      })
      .where(eq(projectUpdates.id, updateId));

    // 4. Update project totals
    await tx
      .update(projects)
      .set({
        currentFundBalance: String(currentBal),
        totalEarnings: String(totalEarnings),
        totalExpenses: String(totalExpenses),
      })
      .where(eq(projects.id, id));

    // 5. Update fund impact
    if (project.linkedFundId) {
      const [fund] = await tx
        .select()
        .from(funds)
        .where(eq(funds.id, project.linkedFundId));

      if (fund) {
        let fundBal = Number(fund.balance);

        // Revert old
        if (oldType === 'Earning') fundBal -= oldAmount;
        else if (oldType === 'Expense') fundBal += oldAmount;

        // Apply new
        if (type === 'Earning') fundBal += newAmount;
        else if (type === 'Expense') fundBal -= newAmount;

        await tx
          .update(funds)
          .set({ balance: String(fundBal) })
          .where(eq(funds.id, project.linkedFundId));
      }
    }

    // 6. Correction audit transaction
    const authUser = getReqUser(req);
    await tx.insert(transactions).values({
      type: 'Adjustment',
      amount: '0',
      description: `[Correction: ${project.title}] Updated event: ${description} (Was: ${oldType} ${oldAmount}, Now: ${type} ${newAmount})`,
      projectId: id,
      fundId: project.linkedFundId,
      authorizedBy: authUser?._id ?? null,
      date: new Date(),
    });

    // 7. System audit log
    await tx.insert(auditLogs).values({
      user: authUser?._id ?? null,
      userName: authUser?.name ?? 'System',
      action: 'EDIT_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: {
        message: `Edited update for project ${project.title}`,
        previous: { type: oldType, amount: oldAmount },
        current: { type, amount: newAmount, description },
      },
      ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    // Re-fetch
    const [fullProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    return fullProject;
  });

  queueStatsRecalculation();
  cache.invalidateByPrefix('projects:');

  const updates = await db
    .select()
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, id))
    .orderBy(projectUpdates.date);

  const members = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, id));

  res.json({
    ...fullProject,
    updates,
    involvedMembers: members,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id/updates/:updateId — remove an update record
// ---------------------------------------------------------------------------
const deleteProjectUpdate = asyncHandler(async (req, res) => {
  const db = getDb();
  const id = req.params.id as string;
  const updateId = req.params.updateId as string;

  const fullProject = await db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      res.status(404);
      throw new Error('Project not found');
    }

    const [update] = await tx
      .select()
      .from(projectUpdates)
      .where(eq(projectUpdates.id, updateId));

    if (!update) {
      res.status(404);
      throw new Error('Update record not found');
    }

    const { type, amount: updAmount, description: updDesc } = update;
    const updateAmount = Number(updAmount);

    // 1. Revert impact on project
    let currentBal = Number(project.currentFundBalance) || 0;
    let totalEarnings = Number(project.totalEarnings) || 0;
    let totalExpenses = Number(project.totalExpenses) || 0;

    if (type === 'Earning') {
      currentBal -= updateAmount;
      totalEarnings -= updateAmount;
    } else if (type === 'Expense') {
      currentBal += updateAmount;
      totalExpenses -= updateAmount;
    }

    await tx
      .update(projects)
      .set({
        currentFundBalance: String(currentBal),
        totalEarnings: String(totalEarnings),
        totalExpenses: String(totalExpenses),
      })
      .where(eq(projects.id, id));

    // 2. Delete the update record
    await tx
      .delete(projectUpdates)
      .where(eq(projectUpdates.id, updateId));

    // 3. Revert fund impact
    if (project.linkedFundId) {
      const [fund] = await tx
        .select()
        .from(funds)
        .where(eq(funds.id, project.linkedFundId));

      if (fund) {
        let fundBal = Number(fund.balance);
        if (type === 'Earning') fundBal -= updateAmount;
        else if (type === 'Expense') fundBal += updateAmount;

        await tx
          .update(funds)
          .set({ balance: String(fundBal) })
          .where(eq(funds.id, project.linkedFundId));
      }
    }

    // 4. Reversal audit transaction
    const authUser = getReqUser(req);
    await tx.insert(transactions).values({
      type: 'Adjustment',
      amount: String(updateAmount),
      description: `[Reversal: ${project.title}] Removed event: ${updDesc}`,
      projectId: id,
      fundId: project.linkedFundId,
      authorizedBy: authUser?._id ?? null,
      date: new Date(),
    });

    // 5. System audit log
    await tx.insert(auditLogs).values({
      user: authUser?._id ?? null,
      userName: authUser?.name ?? 'System',
      action: 'DELETE_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: {
        message: `Deleted update from project ${project.title}`,
        deletedRecord: { type, amount: updateAmount, description: updDesc },
      },
      ipAddress: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    });

    // Re-fetch
    const [fullProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    return fullProject;
  });

  queueStatsRecalculation();
  cache.invalidateByPrefix('projects:');

  const updates = await db
    .select()
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, id))
    .orderBy(projectUpdates.date);

  const members = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, id));

  res.json({
    ...fullProject,
    updates,
    involvedMembers: members,
  });
});

export {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  addProjectUpdate,
  editProjectUpdate,
  deleteProjectUpdate,
};
