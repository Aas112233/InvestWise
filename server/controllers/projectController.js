import asyncHandler from 'express-async-handler';
import Project from '../models/Project.js';
import { logAudit } from '../utils/auditLogger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { recalculateAllStats } from './analyticsController.js';
import mongoose from 'mongoose';
import Fund from '../models/Fund.js';
import Transaction from '../models/Transaction.js';
import AuditLog from '../models/AuditLog.js';

// @desc    Get all projects
// @route   GET /api/projects
// @access  Private
const getProjects = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = req.query.search || '';

    // Create search filter
    const query = search
        ? {
            $or: [
                { title: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ]
        }
        : {};

    const totalCount = await Project.countDocuments(query);
    const projects = await Project.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    res.json(formatPaginatedResponse(projects, page, limit, totalCount));
});

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Private
const getProjectById = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id);

    if (project) {
        res.json(project);
    } else {
        res.status(404);
        throw new Error('Project not found');
    }
});

// @desc    Create a project
// @route   POST /api/projects
// @access  Private/Admin
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

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Calculate ownership percentages
        const processedMembers = (involvedMembers || []).map(m => ({
            ...m,
            ownershipPercentage: totalShares > 0 ? (m.sharesInvested / totalShares) * 100 : 0
        }));

        // 1. Create the Project Object first (to get ID)
        const projects = await Project.create([{
            title,
            category,
            description,
            initialInvestment,
            budget: budget || initialInvestment,
            expectedRoi: expectedRoi || 0,
            totalShares,
            startDate,
            completionDate,
            projectFundHandler,
            involvedMembers: processedMembers,
            currentFundBalance: initialInvestment || 0,
            updates: []
        }], { session });

        const project = projects[0];

        // 2. Auto-Create Project Fund
        const projectFund = await Fund.create([{
            name: `${title} Fund`,
            type: 'PROJECT',
            status: 'ACTIVE',
            currency: 'BDT',
            linkedProjectId: project._id,
            balance: 0, // Will be incremented if initialInvestment > 0
            description: `Auto-generated fund for project: ${title}`
        }], { session });

        // Link project to fund handler if needed, or we just rely on linkedProjectId
        project.linkedFundId = projectFund[0]._id;
        await project.save({ session });


        // 3. Handle Initial Investment (Funding)
        if (initialInvestment > 0) {
            // Find legacy primary or DEPOSIT fund
            // Find an active Primary/Deposit fund with enough balance to source the initial investment
            const sourceFund = await Fund.findOne({
                type: { $in: ['Primary', 'DEPOSIT'] },
                status: 'ACTIVE',
                balance: { $gte: Number(initialInvestment) }
            }).session(session);

            if (!sourceFund) {
                // Determine the best available fund for a descriptive error message
                const bestFund = await Fund.findOne({
                    type: { $in: ['Primary', 'DEPOSIT'] },
                    status: 'ACTIVE'
                }).sort({ balance: -1 }).session(session);

                if (!bestFund) {
                    throw new Error('No Active Primary/Deposit Fund found to source the initial investment.');
                }
                throw new Error(`Project Authorization Failed: Insufficient liquidity in enterprise reserves. Required: BDT ${Number(initialInvestment).toLocaleString()}, Highest available fund (${bestFund.name}) only has BDT ${bestFund.balance.toLocaleString()}.`);
            }

            // Debit Source
            sourceFund.balance -= Number(initialInvestment);
            await sourceFund.save({ session });

            // Credit Project Fund
            projectFund[0].balance += Number(initialInvestment);
            await projectFund[0].save({ session });

            // Record Transaction: Credit to Project Fund
            await Transaction.create([{
                type: 'Investment',
                amount: Number(initialInvestment),
                description: `Project Funding Received: ${title}`,
                fundId: projectFund[0]._id, // Money went HERE
                projectId: project._id,
                authorizedBy: req.user._id,
                date: startDate || Date.now()
            }], { session });

            // Record Transaction: Debit from Source Fund
            await Transaction.create([{
                type: 'Withdrawal',
                amount: Number(initialInvestment),
                description: `Investment Sent to Project: ${title}`,
                fundId: sourceFund._id, // Money left HERE
                projectId: project._id,
                authorizedBy: req.user._id,
                date: startDate || Date.now()
            }], { session });

            // Optional: Record the debit side? Usually double-entry ledger requires 2 rows or correct +/- logic
            // For now, we recorded the Credit side (Investment into Project).
            // We might want a "Transfer Out" record for sourceFund for perfect audit. 
            // Letting it slide for now to keep complexity manageable unless user requested strict double entry.
        }

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(201).json(project);

    } catch (error) {
        await session.abortTransaction();
        console.error('Project Creation Error:', error.message, '| Body:', JSON.stringify(req.body));
        res.status(400);
        throw new Error(error.message || 'Project creation failed');
    } finally {
        session.endSession();
    }
});

// @desc    Update project
// @route   PUT /api/projects/:id
// @access  Private/Admin
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

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const project = await Project.findById(id).session(session);

        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        // FEATURE: Structural Lock - Cannot edit if there are operational updates
        if (project.updates && project.updates.length > 0) {
            throw new Error(`Modification Restricted: This project has ${project.updates.length} active operational records. These must be purged or reconciled before structural changes are allowed.`);
        }

        // Calculate ownership percentages for new members list
        const processedMembers = (involvedMembers || []).map(m => ({
            ...m,
            ownershipPercentage: totalShares > 0 ? (m.sharesInvested / totalShares) * 100 : 0
        }));

        const oldInitialInvestment = project.initialInvestment || 0;
        const newInitialInvestment = initialInvestment !== undefined ? Number(initialInvestment) : oldInitialInvestment;

        // Update Project fields
        project.title = title || project.title;
        project.category = category || project.category;
        project.description = description || project.description;
        project.budget = budget !== undefined ? Number(budget) : project.budget;
        project.expectedRoi = expectedRoi !== undefined ? Number(expectedRoi) : project.expectedRoi;
        project.totalShares = totalShares !== undefined ? Number(totalShares) : project.totalShares;
        project.startDate = startDate || project.startDate;
        project.completionDate = completionDate || project.completionDate;
        project.projectFundHandler = projectFundHandler || project.projectFundHandler;
        project.involvedMembers = processedMembers;
        project.status = status || project.status;
        project.health = health || project.health;
        project.initialInvestment = newInitialInvestment;

        // Handle Fund Adjustments if initialInvestment changed
        if (newInitialInvestment !== oldInitialInvestment) {
            const delta = newInitialInvestment - oldInitialInvestment;
            const projectFund = await Fund.findById(project.linkedFundId).session(session);

            if (!projectFund) throw new Error('Associated Project Fund not found.');

            if (delta > 0) {
                // Need more funds from enterprise reserves
                const sourceFund = await Fund.findOne({
                    type: { $in: ['Primary', 'DEPOSIT'] },
                    status: 'ACTIVE',
                    balance: { $gte: delta }
                }).session(session);

                if (!sourceFund) {
                    const bestFund = await Fund.findOne({
                        type: { $in: ['Primary', 'DEPOSIT'] },
                        status: 'ACTIVE'
                    }).sort({ balance: -1 }).session(session);

                    throw new Error(`Insufficient liquidity in enterprise reserves. Required additional: BDT ${delta.toLocaleString()}. Highest available fund (${bestFund?.name || 'N/A'}) only has BDT ${bestFund?.balance.toLocaleString() || 0}.`);
                }

                sourceFund.balance -= delta;
                projectFund.balance += delta;
                project.currentFundBalance += delta;

                await sourceFund.save({ session });
                await projectFund.save({ session });

                // Record Audit Transactions
                await Transaction.create([{
                    type: 'Investment',
                    amount: delta,
                    description: `Project Funding Increased: ${project.title}`,
                    fundId: projectFund._id,
                    projectId: project._id,
                    authorizedBy: req.user._id,
                    date: Date.now()
                }, {
                    type: 'Withdrawal',
                    amount: delta,
                    description: `Additional Investment to Project: ${project.title}`,
                    fundId: sourceFund._id,
                    projectId: project._id,
                    authorizedBy: req.user._id,
                    date: Date.now()
                }], { session });

            } else {
                // Negative delta: Partial divestment / fund recovery
                const refundAmount = Math.abs(delta);

                // Ensure project fund has enough to refund (can't refund money already spent)
                if (projectFund.balance < refundAmount) {
                    throw new Error(`Divestment Failed: Project fund only has BDT ${projectFund.balance.toLocaleString()} available liquidity. To reduce initial investment by BDT ${refundAmount.toLocaleString()}, you must first recover project liquidity.`);
                }

                const targetFund = await Fund.findOne({
                    type: { $in: ['Primary', 'DEPOSIT'] },
                    status: 'ACTIVE'
                }).session(session);

                if (!targetFund) throw new Error('No target Primary/Deposit fund found to receive refund.');

                projectFund.balance -= refundAmount;
                targetFund.balance += refundAmount;
                project.currentFundBalance -= refundAmount;

                await projectFund.save({ session });
                await targetFund.save({ session });

                // Record Audit Transactions
                await Transaction.create([{
                    type: 'Withdrawal',
                    amount: refundAmount,
                    description: `Project Funding Reduced: ${project.title}`,
                    fundId: projectFund._id,
                    projectId: project._id,
                    authorizedBy: req.user._id,
                    date: Date.now()
                }, {
                    type: 'Investment',
                    amount: refundAmount,
                    description: `Investment Refund from Project: ${project.title}`,
                    fundId: targetFund._id,
                    projectId: project._id,
                    authorizedBy: req.user._id,
                    date: Date.now()
                }], { session });
            }
        }

        const updatedProject = await project.save({ session });
        await session.commitTransaction();
        await recalculateAllStats();

        // Audit Log
        await logAudit({
            req,
            user: req.user,
            action: 'UPDATE_PROJECT',
            resourceType: 'Project',
            resourceId: project._id,
            details: { title: project.title, changes: req.body }
        });

        res.json(updatedProject);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Project update failed');
    } finally {
        session.endSession();
    }
});

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private/Admin
const deleteProject = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id);

    if (!project) {
        res.status(404);
        throw new Error('Project not found');
    }

    // FEATURE: Termination Lock - Cannot delete if there are operational updates
    if (project.updates && project.updates.length > 0) {
        throw new Error(`Termination Forbidden: Project "${project.title}" has active operational records. These must be purged or reconciled individually before the project can be terminated.`);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. REVERSION: Return liquidity to enterprise reserves
        // Any remaining balance in the project fund should go back to Primary/Enterprise reserves
        const projectFund = await Fund.findById(project.linkedFundId).session(session);
        const amountToRevert = projectFund ? projectFund.balance : (project.initialInvestment || 0);

        if (amountToRevert > 0) {
            const enterpriseFund = await Fund.findOne({
                type: { $in: ['Primary', 'DEPOSIT'] },
                status: 'ACTIVE'
            }).session(session);

            if (enterpriseFund) {
                enterpriseFund.balance += Number(amountToRevert);
                await enterpriseFund.save({ session });

                // Record the Reversion Transaction for Audit
                await Transaction.create([{
                    type: 'Investment',
                    amount: Number(amountToRevert),
                    description: `Project Liquidation: Funds returned from ${project.title}`,
                    fundId: enterpriseFund._id,
                    authorizedBy: req.user._id,
                    date: Date.now()
                }], { session });
            }
        }

        // 2. PURGE associated Transactions
        await Transaction.deleteMany({ projectId: req.params.id }).session(session);

        // 3. PURGE associated Fund
        if (project.linkedFundId) {
            await Fund.findByIdAndDelete(project.linkedFundId).session(session);
        }

        // 4. PURGE project record
        await project.deleteOne({ session });

        await session.commitTransaction();
        await recalculateAllStats();

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
        await session.abortTransaction();
        res.status(400);
        throw new Error(`Purge Failed: ${error.message}`);
    } finally {
        session.endSession();
    }
});

// @desc    Add update to project (earning/expense)
// @route   POST /api/projects/:id/updates
// @access  Private
const addProjectUpdate = asyncHandler(async (req, res) => {
    const { type, amount, description, date } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const project = await Project.findById(req.params.id).session(session);
        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        const updateDate = date || Date.now();
        const updateAmount = Number(amount);

        // 1. Update Project Totals
        if (type === 'Earning') {
            project.currentFundBalance += updateAmount;
            project.totalEarnings += updateAmount;
        } else if (type === 'Expense') {
            project.currentFundBalance -= updateAmount;
            project.totalExpenses += updateAmount;
        }

        project.updates.push({
            type,
            amount: updateAmount,
            description,
            date: updateDate,
        });

        await project.save({ session });

        // 2. Update Associated Fund
        if (project.linkedFundId) {
            const fund = await Fund.findById(project.linkedFundId).session(session);
            if (fund) {
                if (type === 'Earning') {
                    fund.balance += updateAmount;
                } else if (type === 'Expense') {
                    fund.balance -= updateAmount;
                }
                await fund.save({ session });
            }
        }

        // 3. Record Audit Transaction
        await Transaction.create([{
            type: type,
            amount: updateAmount,
            description: `[Project Update: ${project.title}] ${description}`,
            projectId: project._id,
            fundId: project.linkedFundId,
            date: updateDate,
            status: 'Success',
            authorizedBy: req.user._id
        }], { session });

        // 4. Audit Log (System Activity)
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'ADD_PROJECT_UPDATE',
            resourceType: 'Project',
            resourceId: project._id,
            details: {
                message: `Added ${type.toLowerCase()} of ${updateAmount} to project ${project.title}`,
                type,
                amount: updateAmount,
                description
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(201).json(project);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Project update failed');
    } finally {
        session.endSession();
    }
});

// @desc    Edit update from project
// @route   PUT /api/projects/:id/updates/:updateId
// @access  Private
const editProjectUpdate = asyncHandler(async (req, res) => {
    const { type, amount, description, date } = req.body;
    const { id, updateId } = req.params;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const project = await Project.findById(id).session(session);
        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        const update = project.updates.id(updateId);
        if (!update) {
            res.status(404);
            throw new Error('Update record not found');
        }

        const oldType = update.type;
        const oldAmount = update.amount;
        const newAmount = Number(amount);
        const newDate = date || update.date;

        // 1. Revert Old Impact
        if (oldType === 'Earning') {
            project.currentFundBalance -= oldAmount;
            project.totalEarnings -= oldAmount;
        } else if (oldType === 'Expense') {
            project.currentFundBalance += oldAmount;
            project.totalExpenses -= oldAmount;
        }

        // 2. Apply New Impact
        if (type === 'Earning') {
            project.currentFundBalance += newAmount;
            project.totalEarnings += newAmount;
        } else if (type === 'Expense') {
            project.currentFundBalance -= newAmount;
            project.totalExpenses += newAmount;
        }

        // 3. Update Subdocument
        update.type = type;
        update.amount = newAmount;
        update.description = description;
        update.date = newDate;

        await project.save({ session });

        // 4. Update Fund Impact
        if (project.linkedFundId) {
            const fund = await Fund.findById(project.linkedFundId).session(session);
            if (fund) {
                // Revert Old
                if (oldType === 'Earning') fund.balance -= oldAmount;
                else if (oldType === 'Expense') fund.balance += oldAmount;

                // Apply New
                if (type === 'Earning') fund.balance += newAmount;
                else if (type === 'Expense') fund.balance -= newAmount;

                await fund.save({ session });
            }
        }

        // 5. Audit Log (Correction)
        await Transaction.create([{
            type: 'Adjustment', // Using Adjustment to denote internal correction
            amount: 0,
            description: `[Correction: ${project.title}] Updated event: ${description} (Was: ${oldType} ${oldAmount}, Now: ${type} ${newAmount})`,
            projectId: project._id,
            fundId: project.linkedFundId,
            authorizedBy: req.user._id,
            date: Date.now()
        }], { session });

        // 6. Audit Log (System Activity)
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'EDIT_PROJECT_UPDATE',
            resourceType: 'Project',
            resourceId: project._id,
            details: {
                message: `Edited update for project ${project.title}`,
                previous: { type: oldType, amount: oldAmount },
                current: { type, amount: newAmount, description }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(project);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Failed to edit update');
    } finally {
        session.endSession();
    }
});

// @desc    Delete update from project
// @route   DELETE /api/projects/:id/updates/:updateId
// @access  Private
const deleteProjectUpdate = asyncHandler(async (req, res) => {
    const { id, updateId } = req.params;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const project = await Project.findById(id).session(session);
        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        const update = project.updates.id(updateId);
        if (!update) {
            res.status(404);
            throw new Error('Update record not found');
        }

        const { type, amount } = update;

        // 1. Revert Impact on Project
        if (type === 'Earning') {
            project.currentFundBalance -= amount;
            project.totalEarnings -= amount;
        } else if (type === 'Expense') {
            project.currentFundBalance += amount;
            project.totalExpenses -= amount;
        }

        // 2. Remove Subdocument
        // update.remove() is deprecated in newer Mongoose
        project.updates.pull({ _id: updateId });
        await project.save({ session });

        // 3. Revert Impact on Fund
        if (project.linkedFundId) {
            const fund = await Fund.findById(project.linkedFundId).session(session);
            if (fund) {
                if (type === 'Earning') fund.balance -= amount;
                else if (type === 'Expense') fund.balance += amount;
                await fund.save({ session });
            }
        }

        // 4. Audit Log
        await Transaction.create([{
            type: 'Adjustment',
            amount: amount,
            description: `[Reversal: ${project.title}] Removed event: ${update.description}`,
            projectId: project._id,
            fundId: project.linkedFundId,
            authorizedBy: req.user._id,
            date: Date.now()
        }], { session });

        // 5. Audit Log (System Activity)
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'DELETE_PROJECT_UPDATE',
            resourceType: 'Project',
            resourceId: project._id,
            details: {
                message: `Deleted update from project ${project.title}`,
                deletedRecord: { type, amount, description: update.description }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(project);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Failed to delete update');
    } finally {
        session.endSession();
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
