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
                throw new Error(`Venture Authorization Failed: Insufficient liquidity in enterprise reserves. Required: BDT ${Number(initialInvestment).toLocaleString()}, Highest available fund (${bestFund.name}) only has BDT ${bestFund.balance.toLocaleString()}.`);
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

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Delete associated Transactions linked to this project
        await Transaction.deleteMany({ projectId: req.params.id }).session(session);

        // 2. Delete the auto-generated Fund linked to this project
        if (project.linkedFundId) {
            await Fund.findByIdAndDelete(project.linkedFundId).session(session);
        }

        // 3. Finally delete the project record
        await project.deleteOne({ session });

        await session.commitTransaction();
        res.json({ message: 'Project and all associated financial records purged successfully.' });
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
            project.totalEarnings += Number(amount);
        } else if (type === 'Expense') {
            project.currentFundBalance -= Number(amount);
            project.totalExpenses += Number(amount);
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
