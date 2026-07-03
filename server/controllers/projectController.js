import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { projects, projectUpdates, projectMembers, funds, transactions, auditLogs, systemSettings } from '../db/schema/index.js';
import { eq, and, desc, count, ilike, or, inArray } from 'drizzle-orm';
import { logAudit } from '../utils/auditLogger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { queueStatsRecalculation } from './analyticsController.js';
import cache from '../utils/cache.js';
import { normalizeCurrencyCode, formatMoney } from '../utils/currency.js';

// @desc Get all projects
// @route GET /api/projects
// @access Private
const getProjects = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(req.query);
  const search = req.query.search || '';

  // Create search filter
  const searchFilter = search
    ? or(
        ilike(projects.title, `%${search}%`),
        ilike(projects.category, `%${search}%`)
      )
    : undefined;

  const [totalCountResult, projectsData] = await Promise.all([
    db.select({ count: count() }).from(projects).where(searchFilter),
    db.select()
      .from(projects)
      .where(searchFilter)
      .orderBy(desc(projects.createdAt))
      .offset(skip)
      .limit(limit)
  ]);

  const totalCount = Number(totalCountResult[0]?.count || 0);

  res.json(formatPaginatedResponse(projectsData, page, limit, totalCount));
});

// @desc Get project by ID
// @route GET /api/projects/:id
// @access Private
const getProjectById = asyncHandler(async (req, res) => {
  const db = getDb();

  const projectsData = await db.select()
    .from(projects)
    .where(eq(projects.id, req.params.id))
    .limit(1);

  if (!projectsData.length) {
    res.status(404);
    throw new Error('Project not found');
  }

  const project = projectsData[0];

  // Fetch involved members from the project_members table
  const involvedMembers = await db.select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, project.id));

  // Fetch project updates from the project_updates table
  const updates = await db.select()
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, project.id))
    .orderBy(desc(projectUpdates.createdAt));

  res.json({
    ...project,
    involvedMembers,
    updates
  });
});

// @desc Create a project
// @route POST /api/projects
// @access Private/Admin
const createProject = asyncHandler(async (req, res) => {
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
    projectFundHandler
  } = req.body;

  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const settingsResult = await tx.select().from(systemSettings).limit(1);
      const settings = settingsResult[0] || {};
      const currencyCode = normalizeCurrencyCode(settings.baseCurrency);

      // Calculate ownership percentages
      const processedMembers = (involvedMembers || []).map(m => ({
        memberId: m.memberId,
        sharesInvested: Number(m.sharesInvested) || 0,
        ownershipPercentage: Number(totalShares) > 0 ? ((Number(m.sharesInvested) || 0) / Number(totalShares)) * 100 : 0
      }));

      // 1. Create the Project Object first (to get ID)
      const [newProject] = await tx.insert(projects).values({
        title,
        category,
        description,
        initialInvestment: String(initialInvestment || 0),
        budget: String(budget || initialInvestment || 0),
        expectedRoi: String(expectedRoi || 0),
        totalShares: Number(totalShares) || 0,
        startDate: new Date(startDate),
        completionDate: completionDate ? new Date(completionDate) : null,
        projectFundHandler,
        currentFundBalance: String(initialInvestment || 0)
      }).returning();

      // Insert project members into the project_members table
      if (processedMembers.length > 0) {
        await tx.insert(projectMembers).values(
          processedMembers.map(m => ({
            projectId: newProject.id,
            memberId: m.memberId,
            sharesInvested: m.sharesInvested,
            ownershipPercentage: String(m.ownershipPercentage)
          }))
        );
      }

      // 2. Auto-Create Project Fund
      const [projectFund] = await tx.insert(funds).values({
        name: `${title} Fund`,
        type: 'PROJECT',
        status: 'ACTIVE',
        currency: currencyCode,
        linkedProjectId: newProject.id,
        balance: '0',
        description: `Auto-generated fund for project: ${title}`
      }).returning();

      // Link project to fund handler
      newProject.linkedFundId = projectFund.id;
      await tx.update(projects).set({ linkedFundId: projectFund.id }).where(eq(projects.id, newProject.id));

      // 3. Handle Initial Investment (Funding)
      if (Number(initialInvestment) > 0) {
        // Find an active Primary/Deposit fund with enough balance to source the initial investment
        const sourceFunds = await tx.select()
          .from(funds)
          .where(and(
            inArray(funds.type, ['Primary', 'DEPOSIT']),
            eq(funds.status, 'ACTIVE')
          ))
          .orderBy(desc(funds.balance));

        const sourceFund = sourceFunds.find(f => Number(f.balance) >= Number(initialInvestment));

        if (!sourceFund) {
          const bestFund = sourceFunds[0];

          if (!bestFund) {
            throw new Error('No Active Primary/Deposit Fund found to source the initial investment.');
          }
          throw new Error(`Project Authorization Failed: Insufficient liquidity in enterprise reserves. Required: ${formatMoney(Number(initialInvestment), currencyCode)}, Highest available fund (${bestFund.name}) only has ${formatMoney(Number(bestFund.balance), currencyCode)}.`);
        }

        // Debit Source
        const newSourceBalance = Number(sourceFund.balance) - Number(initialInvestment);
        await tx.update(funds).set({ balance: String(newSourceBalance) }).where(eq(funds.id, sourceFund.id));

        // Credit Project Fund
        const newProjectFundBalance = Number(projectFund.balance) + Number(initialInvestment);
        await tx.update(funds).set({ balance: String(newProjectFundBalance) }).where(eq(funds.id, projectFund.id));

        // Record Transaction: Credit to Project Fund
        await tx.insert(transactions).values({
          type: 'Investment',
          amount: String(Number(initialInvestment)),
          description: `Project Funding Received: ${title}`,
          fundId: projectFund.id,
          projectId: newProject.id,
          authorizedBy: req.user.id,
          date: startDate ? new Date(startDate) : new Date()
        });

        // Record Transaction: Debit from Source Fund
        await tx.insert(transactions).values({
          type: 'Withdrawal',
          amount: String(Number(initialInvestment)),
          description: `Investment Sent to Project: ${title}`,
          fundId: sourceFund.id,
          projectId: newProject.id,
          authorizedBy: req.user.id,
          date: startDate ? new Date(startDate) : new Date()
        });
      }

      return newProject;
    });

    queueStatsRecalculation();
    // Invalidate cache
    cache.invalidateByPrefix('projects:');
    res.status(201).json(result);

  } catch (error) {
    console.error('Project Creation Error:', error.message, '| Body:', JSON.stringify(req.body));
    res.status(400);
    throw new Error(error.message || 'Project creation failed');
  }
});

// @desc Update project
// @route PUT /api/projects/:id
// @access Private/Admin
const updateProject = asyncHandler(async (req, res) => {
  const { id } = req.params;
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
    health
  } = req.body;

  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const settingsResult = await tx.select().from(systemSettings).limit(1);
      const settings = settingsResult[0] || {};
      const currencyCode = normalizeCurrencyCode(settings.baseCurrency);

      const projectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

      if (!projectsData.length) {
        res.status(404);
        throw new Error('Project not found');
      }

      const project = projectsData[0];

      // FEATURE: Structural Lock - Cannot edit if there are operational updates
      const updatesCountResult = await tx.select({ count: count() })
        .from(projectUpdates)
        .where(eq(projectUpdates.projectId, id));

      const updatesCount = Number(updatesCountResult[0]?.count || 0);
      if (updatesCount > 0) {
        throw new Error(`Modification Restricted: This project has ${updatesCount} active operational records. These must be purged or reconciled before structural changes are allowed.`);
      }

      // Calculate ownership percentages for new members list
      const processedMembers = (involvedMembers || []).map(m => ({
        memberId: m.memberId,
        sharesInvested: Number(m.sharesInvested) || 0,
        ownershipPercentage: Number(totalShares) > 0 ? ((Number(m.sharesInvested) || 0) / Number(totalShares)) * 100 : 0
      }));

      const oldInitialInvestment = Number(project.initialInvestment) || 0;
      const newInitialInvestment = initialInvestment !== undefined ? Number(initialInvestment) : oldInitialInvestment;

      // Update Project fields
      const updateData = {
        title: title || project.title,
        category: category || project.category,
        description: description || project.description,
        budget: budget !== undefined ? String(budget) : project.budget,
        expectedRoi: expectedRoi !== undefined ? String(expectedRoi) : project.expectedRoi,
        totalShares: totalShares !== undefined ? Number(totalShares) : project.totalShares,
        startDate: startDate ? new Date(startDate) : project.startDate,
        completionDate: completionDate !== undefined ? (completionDate ? new Date(completionDate) : null) : project.completionDate,
        projectFundHandler: projectFundHandler || project.projectFundHandler,
        status: status || project.status,
        health: health || project.health,
        initialInvestment: String(newInitialInvestment)
      };

      // Handle Fund Adjustments if initialInvestment changed
      if (newInitialInvestment !== oldInitialInvestment) {
        const delta = newInitialInvestment - oldInitialInvestment;

        const projectFundsData = await tx.select()
          .from(funds)
          .where(eq(funds.id, project.linkedFundId))
          .limit(1);

        if (!projectFundsData.length) throw new Error('Associated Project Fund not found.');
        const projectFund = projectFundsData[0];

        if (delta > 0) {
          // Need more funds from enterprise reserves
          const sourceFunds = await tx.select()
            .from(funds)
            .where(and(
              inArray(funds.type, ['Primary', 'DEPOSIT']),
              eq(funds.status, 'ACTIVE')
            ))
            .orderBy(desc(funds.balance));

          const sourceFund = sourceFunds.find(f => Number(f.balance) >= delta);

          if (!sourceFund) {
            const bestFund = sourceFunds[0];
            throw new Error(`Insufficient liquidity in enterprise reserves. Required additional: ${formatMoney(delta, currencyCode)}. Highest available fund (${bestFund?.name || 'N/A'}) only has ${formatMoney(Number(bestFund?.balance || 0), currencyCode)}.`);
          }

          const newSourceBalance = Number(sourceFund.balance) - delta;
          const newProjectFundBalance = Number(projectFund.balance) + delta;
          const newCurrentFundBalance = Number(project.currentFundBalance || 0) + delta;

          updateData.currentFundBalance = String(newCurrentFundBalance);

          await tx.update(funds).set({ balance: String(newSourceBalance) }).where(eq(funds.id, sourceFund.id));
          await tx.update(funds).set({ balance: String(newProjectFundBalance) }).where(eq(funds.id, projectFund.id));

          // Record Audit Transactions
          await tx.insert(transactions).values([{
            type: 'Investment',
            amount: String(delta),
            description: `Project Funding Increased: ${project.title}`,
            fundId: projectFund.id,
            projectId: project.id,
            authorizedBy: req.user.id,
            date: new Date()
          }, {
            type: 'Withdrawal',
            amount: String(delta),
            description: `Additional Investment to Project: ${project.title}`,
            fundId: sourceFund.id,
            projectId: project.id,
            authorizedBy: req.user.id,
            date: new Date()
          }]);

        } else {
          // Negative delta: Partial divestment / fund recovery
          const refundAmount = Math.abs(delta);

          // Ensure project fund has enough to refund
          if (Number(projectFund.balance) < refundAmount) {
            throw new Error(`Divestment Failed: Project fund only has ${formatMoney(Number(projectFund.balance), currencyCode)} available liquidity. To reduce initial investment by ${formatMoney(refundAmount, currencyCode)}, you must first recover project liquidity.`);
          }

          const originalInvestmentTxData = await tx.select()
            .from(transactions)
            .where(and(
              eq(transactions.projectId, project.id),
              eq(transactions.type, 'Withdrawal')
            ))
            .orderBy(transactions.date)
            .limit(1);

          let targetFund;

          if (originalInvestmentTxData.length) {
            const targetFundsData = await tx.select()
              .from(funds)
              .where(eq(funds.id, originalInvestmentTxData[0].fundId))
              .limit(1);
            if (targetFundsData.length) {
              targetFund = targetFundsData[0];
            }
          }

          if (!targetFund) {
            const targetFundsData = await tx.select()
              .from(funds)
              .where(and(
                inArray(funds.type, ['Primary', 'DEPOSIT']),
                eq(funds.status, 'ACTIVE')
              ))
              .limit(1);

            if (targetFundsData.length) {
              targetFund = targetFundsData[0];
            }
          }

          if (!targetFund) throw new Error('No target Primary/Deposit fund found to receive refund.');

          const newProjectFundBalance = Number(projectFund.balance) - refundAmount;
          const newTargetBalance = Number(targetFund.balance) + refundAmount;
          const newCurrentFundBalance = Number(project.currentFundBalance || 0) - refundAmount;

          updateData.currentFundBalance = String(newCurrentFundBalance);

          await tx.update(funds).set({ balance: String(newProjectFundBalance) }).where(eq(funds.id, projectFund.id));
          await tx.update(funds).set({ balance: String(newTargetBalance) }).where(eq(funds.id, targetFund.id));

          // Record Audit Transactions
          await tx.insert(transactions).values([{
            type: 'Withdrawal',
            amount: String(refundAmount),
            description: `Project Funding Reduced: ${project.title}`,
            fundId: projectFund.id,
            projectId: project.id,
            authorizedBy: req.user.id,
            date: new Date()
          }, {
            type: 'Investment',
            amount: String(refundAmount),
            description: `Investment Refund from Project: ${project.title}`,
            fundId: targetFund.id,
            projectId: project.id,
            authorizedBy: req.user.id,
            date: new Date()
          }]);
        }
      }

      // Update the project
      await tx.update(projects).set(updateData).where(eq(projects.id, project.id));

      // Replace involved members: delete existing and insert new
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, project.id));

      if (processedMembers.length > 0) {
        await tx.insert(projectMembers).values(
          processedMembers.map(m => ({
            projectId: project.id,
            memberId: m.memberId,
            sharesInvested: m.sharesInvested,
            ownershipPercentage: String(m.ownershipPercentage)
          }))
        );
      }

      // Return the updated project
      const updatedProjectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, project.id))
        .limit(1);

      return updatedProjectsData[0];
    });

    queueStatsRecalculation();

    // Invalidate cache
    cache.invalidateByPrefix('projects:');

    // Audit Log
    await logAudit({
      req,
      user: req.user,
      action: 'UPDATE_PROJECT',
      resourceType: 'Project',
      resourceId: id,
      details: { title: result.title, changes: req.body }
    });

    res.json(result);

  } catch (error) {
    res.status(400);
    throw new Error(error.message || 'Project update failed');
  }
});

// @desc Delete project
// @route DELETE /api/projects/:id
// @access Private/Admin
const deleteProject = asyncHandler(async (req, res) => {
  const db = getDb();

  const projectsData = await db.select()
    .from(projects)
    .where(eq(projects.id, req.params.id))
    .limit(1);

  if (!projectsData.length) {
    res.status(404);
    throw new Error('Project not found');
  }

  const project = projectsData[0];

  // FEATURE: Termination Lock - Cannot delete if there are operational updates
  const updatesCountResult = await db.select({ count: count() })
    .from(projectUpdates)
    .where(eq(projectUpdates.projectId, project.id));

  const updatesCount = Number(updatesCountResult[0]?.count || 0);
  if (updatesCount > 0) {
    throw new Error(`Termination Forbidden: Project "${project.title}" has active operational records. These must be purged or reconciled individually before the project can be terminated.`);
  }

  try {
    await db.transaction(async (tx) => {
      // 1. REVERSION: Return liquidity to enterprise reserves
      let amountToRevert = Number(project.initialInvestment || 0);

      if (project.linkedFundId) {
        const projectFundsData = await tx.select()
          .from(funds)
          .where(eq(funds.id, project.linkedFundId))
          .limit(1);

        if (projectFundsData.length) {
          const projectFund = projectFundsData[0];
          amountToRevert = Number(projectFund.balance) || amountToRevert;

          if (amountToRevert > 0) {
            const enterpriseFundsData = await tx.select()
              .from(funds)
              .where(and(
                inArray(funds.type, ['Primary', 'DEPOSIT']),
                eq(funds.status, 'ACTIVE')
              ))
              .limit(1);

            if (enterpriseFundsData.length) {
              const enterpriseFund = enterpriseFundsData[0];
              const newEnterpriseBalance = Number(enterpriseFund.balance) + amountToRevert;
              await tx.update(funds).set({ balance: String(newEnterpriseBalance) }).where(eq(funds.id, enterpriseFund.id));

              // Record the Reversion Transaction for Audit
              await tx.insert(transactions).values({
                type: 'Investment',
                amount: String(amountToRevert),
                description: `Project Liquidation: Funds returned from ${project.title}`,
                fundId: enterpriseFund.id,
                authorizedBy: req.user.id,
                date: new Date()
              });
            }
          }
        }
      }

      // 2. ARCHIVE associated Transactions
      await tx.update(transactions)
        .set({ isDeleted: true, status: 'Cancelled' })
        .where(eq(transactions.projectId, req.params.id));

      // 3. ARCHIVE associated Fund
      if (project.linkedFundId) {
        await tx.update(funds)
          .set({ status: 'ARCHIVED' })
          .where(eq(funds.id, project.linkedFundId));
      }

      // 4. PURGE project record
      await tx.delete(projects).where(eq(projects.id, project.id));
    });

    queueStatsRecalculation();

    // Audit Log
    await logAudit({
      req,
      user: req.user,
      action: 'DELETE_PROJECT',
      resourceType: 'Project',
      resourceId: req.params.id,
      details: { title: project.title, finalBalanceReverted: amountToRevert }
    });

    res.json({ message: 'Project terminated successfully. All liquidity has been reconciled to enterprise reserves.' });

  } catch (error) {
    res.status(400);
    throw new Error(`Purge Failed: ${error.message}`);
  }
});

// @desc Add update to project (earning/expense)
// @route POST /api/projects/:id/updates
// @access Private
const addProjectUpdate = asyncHandler(async (req, res) => {
  const { type, amount, description, date } = req.body;
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const projectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, req.params.id))
        .limit(1);

      if (!projectsData.length) {
        res.status(404);
        throw new Error('Project not found');
      }

      const project = projectsData[0];
      const updateDate = date ? new Date(date) : new Date();
      const updateAmount = Number(amount);
      const balanceBefore = Number(project.currentFundBalance || 0);

      // 1. Update Project Totals
      let newCurrentFundBalance = balanceBefore;
      let newTotalEarnings = Number(project.totalEarnings || 0);
      let newTotalExpenses = Number(project.totalExpenses || 0);

      if (type === 'Earning') {
        newCurrentFundBalance += updateAmount;
        newTotalEarnings += updateAmount;
      } else if (type === 'Expense') {
        newCurrentFundBalance -= updateAmount;
        newTotalExpenses += updateAmount;
      }

      const balanceAfter = newCurrentFundBalance;

      // 2. Insert project update record
      await tx.insert(projectUpdates).values({
        projectId: project.id,
        type,
        amount: String(updateAmount),
        description,
        date: updateDate,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter)
      });

      // 3. Update project totals
      await tx.update(projects).set({
        currentFundBalance: String(newCurrentFundBalance),
        totalEarnings: String(newTotalEarnings),
        totalExpenses: String(newTotalExpenses)
      }).where(eq(projects.id, project.id));

      // 4. Update Associated Fund
      if (project.linkedFundId) {
        const fundsData = await tx.select()
          .from(funds)
          .where(eq(funds.id, project.linkedFundId))
          .limit(1);

        if (fundsData.length) {
          const fund = fundsData[0];
          const newFundBalance = type === 'Earning'
            ? Number(fund.balance) + updateAmount
            : Number(fund.balance) - updateAmount;

          await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fund.id));
        }
      }

      // 5. Record Audit Transaction
      await tx.insert(transactions).values({
        type,
        amount: String(updateAmount),
        description: `[Project Update: ${project.title}] ${description}`,
        projectId: project.id,
        fundId: project.linkedFundId,
        date: updateDate,
        status: 'Completed',
        authorizedBy: req.user.id,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter)
      });

      // 6. Audit Log (System Activity)
      await tx.insert(auditLogs).values({
        user: req.user.id,
        userName: req.user.name,
        action: 'ADD_PROJECT_UPDATE',
        resourceType: 'Project',
        resourceId: project.id,
        details: {
          message: `Added ${type.toLowerCase()} of ${updateAmount} to project ${project.title}`,
          type,
          amount: updateAmount,
          description
        },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      // Return updated project data
      return {
        ...project,
        currentFundBalance: String(newCurrentFundBalance),
        totalEarnings: String(newTotalEarnings),
        totalExpenses: String(newTotalExpenses)
      };
    });

    queueStatsRecalculation();

    // Invalidate cache
    cache.invalidateByPrefix('projects:');

    res.status(201).json(result);

  } catch (error) {
    res.status(400);
    throw new Error(error.message || 'Project update failed');
  }
});

// @desc Edit update from project
// @route PUT /api/projects/:id/updates/:updateId
// @access Private
const editProjectUpdate = asyncHandler(async (req, res) => {
  const { type, amount, description, date } = req.body;
  const { id, updateId } = req.params;
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const projectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

      if (!projectsData.length) {
        res.status(404);
        throw new Error('Project not found');
      }

      const project = projectsData[0];

      const updatesData = await tx.select()
        .from(projectUpdates)
        .where(and(
          eq(projectUpdates.projectId, id),
          eq(projectUpdates.id, updateId)
        ))
        .limit(1);

      if (!updatesData.length) {
        res.status(404);
        throw new Error('Update record not found');
      }

      const update = updatesData[0];
      const oldType = update.type;
      const oldAmount = Number(update.amount);
      const newAmount = Number(amount);
      const newDate = date ? new Date(date) : update.date;

      let newCurrentFundBalance = Number(project.currentFundBalance || 0);
      let newTotalEarnings = Number(project.totalEarnings || 0);
      let newTotalExpenses = Number(project.totalExpenses || 0);

      // 1. Revert Old Impact
      if (oldType === 'Earning') {
        newCurrentFundBalance -= oldAmount;
        newTotalEarnings -= oldAmount;
      } else if (oldType === 'Expense') {
        newCurrentFundBalance += oldAmount;
        newTotalExpenses -= oldAmount;
      }

      // 2. Apply New Impact
      if (type === 'Earning') {
        newCurrentFundBalance += newAmount;
        newTotalEarnings += newAmount;
      } else if (type === 'Expense') {
        newCurrentFundBalance -= newAmount;
        newTotalExpenses += newAmount;
      }

      // 3. Update project totals
      await tx.update(projects).set({
        currentFundBalance: String(newCurrentFundBalance),
        totalEarnings: String(newTotalEarnings),
        totalExpenses: String(newTotalExpenses)
      }).where(eq(projects.id, project.id));

      // 4. Update the project_update record
      await tx.update(projectUpdates).set({
        type,
        amount: String(newAmount),
        description,
        date: newDate
      }).where(eq(projectUpdates.id, updateId));

      // 5. Update Fund Impact
      if (project.linkedFundId) {
        const fundsData = await tx.select()
          .from(funds)
          .where(eq(funds.id, project.linkedFundId))
          .limit(1);

        if (fundsData.length) {
          const fund = fundsData[0];
          let newFundBalance = Number(fund.balance);

          // Revert Old
          if (oldType === 'Earning') newFundBalance -= oldAmount;
          else if (oldType === 'Expense') newFundBalance += oldAmount;

          // Apply New
          if (type === 'Earning') newFundBalance += newAmount;
          else if (type === 'Expense') newFundBalance -= newAmount;

          await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fund.id));
        }
      }

      // 6. Audit Log (Correction) - Transaction record
      await tx.insert(transactions).values({
        type: 'Adjustment',
        amount: '0',
        description: `[Correction: ${project.title}] Updated event: ${description} (Was: ${oldType} ${oldAmount}, Now: ${type} ${newAmount})`,
        projectId: project.id,
        fundId: project.linkedFundId,
        authorizedBy: req.user.id,
        date: new Date()
      });

      // 7. Audit Log (System Activity)
      await tx.insert(auditLogs).values({
        user: req.user.id,
        userName: req.user.name,
        action: 'EDIT_PROJECT_UPDATE',
        resourceType: 'Project',
        resourceId: project.id,
        details: {
          message: `Edited update for project ${project.title}`,
          previous: { type: oldType, amount: oldAmount },
          current: { type, amount: newAmount, description }
        },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      // Return updated project
      const updatedProjectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, project.id))
        .limit(1);

      return updatedProjectsData[0];
    });

    queueStatsRecalculation();

    // Invalidate cache
    cache.invalidateByPrefix('projects:');

    res.json(result);

  } catch (error) {
    res.status(400);
    throw new Error(error.message || 'Failed to edit update');
  }
});

// @desc Delete update from project
// @route DELETE /api/projects/:id/updates/:updateId
// @access Private
const deleteProjectUpdate = asyncHandler(async (req, res) => {
  const { id, updateId } = req.params;
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      const projectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

      if (!projectsData.length) {
        res.status(404);
        throw new Error('Project not found');
      }

      const project = projectsData[0];

      const updatesData = await tx.select()
        .from(projectUpdates)
        .where(and(
          eq(projectUpdates.projectId, id),
          eq(projectUpdates.id, updateId)
        ))
        .limit(1);

      if (!updatesData.length) {
        res.status(404);
        throw new Error('Update record not found');
      }

      const update = updatesData[0];
      const { type, amount } = update;
      const numericAmount = Number(amount);

      let newCurrentFundBalance = Number(project.currentFundBalance || 0);
      let newTotalEarnings = Number(project.totalEarnings || 0);
      let newTotalExpenses = Number(project.totalExpenses || 0);

      // 1. Revert Impact on Project
      if (type === 'Earning') {
        newCurrentFundBalance -= numericAmount;
        newTotalEarnings -= numericAmount;
      } else if (type === 'Expense') {
        newCurrentFundBalance += numericAmount;
        newTotalExpenses -= numericAmount;
      }

      // 2. Update project totals
      await tx.update(projects).set({
        currentFundBalance: String(newCurrentFundBalance),
        totalEarnings: String(newTotalEarnings),
        totalExpenses: String(newTotalExpenses)
      }).where(eq(projects.id, project.id));

      // 3. Delete the update record
      await tx.delete(projectUpdates).where(eq(projectUpdates.id, updateId));

      // 4. Revert Impact on Fund
      if (project.linkedFundId) {
        const fundsData = await tx.select()
          .from(funds)
          .where(eq(funds.id, project.linkedFundId))
          .limit(1);

        if (fundsData.length) {
          const fund = fundsData[0];
          const newFundBalance = type === 'Earning'
            ? Number(fund.balance) - numericAmount
            : Number(fund.balance) + numericAmount;

          await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fund.id));
        }
      }

      // 5. Audit Log - Transaction record
      await tx.insert(transactions).values({
        type: 'Adjustment',
        amount: String(numericAmount),
        description: `[Reversal: ${project.title}] Removed event: ${update.description}`,
        projectId: project.id,
        fundId: project.linkedFundId,
        authorizedBy: req.user.id,
        date: new Date()
      });

      // 6. Audit Log (System Activity)
      await tx.insert(auditLogs).values({
        user: req.user.id,
        userName: req.user.name,
        action: 'DELETE_PROJECT_UPDATE',
        resourceType: 'Project',
        resourceId: project.id,
        details: {
          message: `Deleted update from project ${project.title}`,
          deletedRecord: { type, amount: numericAmount, description: update.description }
        },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      });

      // Return updated project
      const updatedProjectsData = await tx.select()
        .from(projects)
        .where(eq(projects.id, project.id))
        .limit(1);

      return updatedProjectsData[0];
    });

    queueStatsRecalculation();

    // Invalidate cache
    cache.invalidateByPrefix('projects:');

    res.json(result);

  } catch (error) {
    res.status(400);
    throw new Error(error.message || 'Failed to delete update');
  }
});

export {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  addProjectUpdate,
  editProjectUpdate,
  deleteProjectUpdate
};
