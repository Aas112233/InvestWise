import asyncHandler from 'express-async-handler';
import Project from '../models/Project.js';

// @desc    Get all projects
// @route   GET /api/projects
// @access  Private
const getProjects = asyncHandler(async (req, res) => {
    const projects = await Project.find({});
    res.json(projects);
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

import mongoose from 'mongoose';
import Fund from '../models/Fund.js';
import Transaction from '../models/Transaction.js';

// @desc    Create a project
// @route   POST /api/projects
// @access  Private/Admin
const createProject = asyncHandler(async (req, res) => {
    const {
        title,
        category,
        description,
        initialInvestment,
        totalShares,
        startDate,
        completionDate,
        involveMembers,
    } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Create the Project Object first (to get ID)
        // We use an array for create with session, returns array
        const projects = await Project.create([{
            title,
            category,
            description,
            initialInvestment,
            totalShares,
            startDate,
            completionDate,
            involvedMembers: involveMembers || [],
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
            const sourceFund = await Fund.findOne({
                type: { $in: ['Primary', 'DEPOSIT'] },
                status: 'ACTIVE'
            }).sort({ createdAt: 1 }).session(session);

            if (!sourceFund) {
                throw new Error('No Active Primary/Deposit Fund found to source the initial investment.');
            }
            if (sourceFund.balance < initialInvestment) {
                throw new Error(`Insufficient funds in ${sourceFund.name} (Balance: ${sourceFund.balance})`);
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
                description: `Capital Injection for Project: ${title}`,
                fundId: projectFund[0]._id, // Money went HERE
                projectId: project._id,
                authorizedBy: req.user._id,
                date: startDate || Date.now()
            }], { session });

            // Record Transaction: Debit from Source Fund
            await Transaction.create([{
                type: 'Withdrawal',
                amount: Number(initialInvestment),
                description: `Investment Outflow to Project: ${title}`,
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
        res.status(201).json(project);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Project creation with automatic funding failed');
    } finally {
        session.endSession();
    }
});

// @desc    Update project
// @route   PUT /api/projects/:id
// @access  Private/Admin
const updateProject = asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id);

    if (project) {
        project.title = req.body.title || project.title;
        project.category = req.body.category || project.category;
        project.description = req.body.description || project.description;
        project.status = req.body.status || project.status;
        project.currentFundBalance = req.body.currentFundBalance !== undefined ? req.body.currentFundBalance : project.currentFundBalance;
        project.completionDate = req.body.completionDate || project.completionDate; // Allow updating completion date

        const updatedProject = await project.save();
        res.json(updatedProject);
    } else {
        res.status(404);
        throw new Error('Project not found');
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

    // Check for associated financial transactions
    const transactionCount = await Transaction.countDocuments({ projectId: req.params.id });
    if (transactionCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete project. It has ${transactionCount} linked financial transactions. Delete them first.`);
    }

    // Check if project has internal updates history that implies financial activity
    // (Although transactions should cover this, updates might be legacy or separate)
    if (project.updates && project.updates.length > 0) {
        // We could force clearing updates, but updates are usually part of the project document.
        // However, if updates involve money, we should be careful.
        // Let's assume strictness: if it has significant history, block it.
        // Or, since updates are sub-documents, deleting the project deletes them.
        // The user said "connected data". Updates are *internal* data so physically they delete with the project.
        // But "Transactions" are external connected data.
        // We already checked Transactions above.
    }

    // Check if there are members involved with non-zero shares?
    // If members have shares, those shares represent value.
    // If we delete the project, those member shares vanish?
    // We should probably check if `currentFundBalance` > 0 or `totalShares` > 0
    if (project.currentFundBalance > 0) {
        res.status(400);
        throw new Error('Cannot delete project with remaining fund balance. Liquidate funds first.');
    }

    await project.deleteOne();
    res.json({ message: 'Project removed' });
});

// @desc    Add update to project (earning/expense)
// @route   POST /api/projects/:id/updates
// @access  Private
const addProjectUpdate = asyncHandler(async (req, res) => {
    const { type, amount, description } = req.body;
    const project = await Project.findById(req.params.id);

    if (project) {
        const update = {
            type,
            amount: Number(amount),
            description,
            date: Date.now(),
        };

        if (type === 'Earning') {
            project.currentFundBalance += Number(amount);
        } else if (type === 'Expense') {
            project.currentFundBalance -= Number(amount);
        }

        project.updates.push(update);
        await project.save();
        res.status(201).json(project);
    } else {
        res.status(404);
        throw new Error('Project not found');
    }
});


export {
    getProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    addProjectUpdate
};
