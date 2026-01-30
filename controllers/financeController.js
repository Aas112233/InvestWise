import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Fund from '../models/Fund.js';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import DeletedRecord from '../models/DeletedRecord.js';
import AuditLog from '../models/AuditLog.js';
import { logAudit } from '../utils/auditLogger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { recalculateAllStats } from './analyticsController.js';

// @desc    Get all transactions
// @route   GET /api/finance/transactions
// @access  Private
const getTransactions = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = req.query.search || '';

    // Create search filter
    const query = search
        ? {
            $or: [
                { type: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { status: { $regex: search, $options: 'i' } }
            ]
        }
        : {};

    const totalCount = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
        .populate('memberId', 'memberId name email')
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit);

    // Calculate totals for inflow and outflow
    const totals = await Transaction.aggregate([
        {
            $match: {
                status: { $in: ['Success', 'Completed'] }
            }
        },
        {
            $group: {
                _id: null,
                totalInflow: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['Deposit', 'Earning', 'Investment']] },
                            '$amount',
                            0
                        ]
                    }
                },
                totalOutflow: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['Expense', 'Withdrawal', 'Dividend']] },
                            '$amount',
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const stats = totals[0] || { totalInflow: 0, totalOutflow: 0 };

    res.json({
        ...formatPaginatedResponse(transactions, page, limit, totalCount),
        totalInflow: stats.totalInflow,
        totalOutflow: stats.totalOutflow
    });
});

// @desc    Add a deposit
// @route   POST /api/finance/deposits
// @access  Private (Admin/Manager)
// @desc    Add a deposit (Direct or Request)
// @route   POST /api/finance/deposits
// @access  Private (Admin/Manager)
const addDeposit = asyncHandler(async (req, res) => {
    console.log('DEBUG addDeposit body:', req.body);
    const { memberId, amount, fundId, description, date, shareNumber, status, cashierName, handlingOfficer, depositMethod } = req.body;

    // Validate inputs
    if (!amount || Number(amount) <= 0) {
        res.status(400);
        throw new Error(`Invalid deposit amount: ${amount}`);
    }

    if (!memberId) {
        res.status(400);
        throw new Error('Member ID is required');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const depositStatus = status || 'Success';

        // 1. Create Transaction Record
        const transaction = await Transaction.create([{
            type: 'Deposit',
            amount: Number(amount),
            description: description,
            memberId,
            fundId,
            date: date || Date.now(),
            status: depositStatus, // 'Success' or 'Pending'
            authorizedBy: req.user._id,
            handlingOfficer: cashierName || handlingOfficer, // Save the officer name
            depositMethod: depositMethod || 'Cash' // Default to Cash if not provided
        }], { session });

        // IF status is 'Success' (Direct Deposit), apply financial impact immediately.
        // IF 'Pending', we skip this.
        if (depositStatus === 'Success' || depositStatus === 'Completed') {
            const fund = await Fund.findById(fundId).session(session);
            const member = await Member.findById(memberId).session(session);

            if (!fund || !member) throw new Error('Fund or Member not found for immediate deposit');

            // Update Fund
            fund.balance += Number(amount);
            await fund.save({ session });

            // Update Member
            member.totalContributed += Number(amount);
            if (shareNumber) {
                member.shares += Number(shareNumber);
            }
            await member.save({ session });
        }

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(201).json(transaction[0]);
    } catch (error) {
        await session.abortTransaction();
        console.error('Deposit Transaction Failed:', error);
        res.status(400);
        throw new Error(error.message || 'Deposit failed');
    } finally {
        session.endSession();
    }
});

// @desc    Edit a deposit
// @route   PUT /api/finance/deposits/:id
// @access  Private (Admin)
const editDeposit = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { memberId, amount, fundId, description, date, shareNumber, cashierName, depositMethod } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transaction = await Transaction.findById(id).session(session);
        if (!transaction) {
            res.status(404);
            throw new Error('Transaction not found');
        }

        if (transaction.type !== 'Deposit') {
            res.status(400);
            throw new Error('Transaction is not a deposit');
        }

        const oldAmount = transaction.amount;
        const oldFundId = transaction.fundId;
        const oldMemberId = transaction.memberId;
        const oldShareImpact = Math.floor(oldAmount / 1000); // Approximation from addDeposit logic

        const newAmount = parseInt(amount);
        const newShareImpact = parseInt(shareNumber);

        // 1. Revert Old Impact
        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            // Revert Fund
            const oldFund = await Fund.findById(oldFundId).session(session);
            if (oldFund) {
                oldFund.balance -= oldAmount;
                await oldFund.save({ session });
            }

            // Revert Member
            const oldMember = await Member.findById(oldMemberId).session(session);
            if (oldMember) {
                oldMember.totalContributed -= oldAmount;
                oldMember.shares -= oldShareImpact;
                await oldMember.save({ session });
            }
        }

        // 2. Apply New Impact
        // Find New Fund (or same)
        const newFund = await Fund.findById(fundId).session(session);
        if (!newFund) throw new Error('Target fund not found');

        newFund.balance += newAmount;
        await newFund.save({ session });

        // Find New Member (or same)
        const newMember = await Member.findById(memberId).session(session);
        if (!newMember) throw new Error('Target member not found');

        newMember.totalContributed += newAmount;
        newMember.shares += newShareImpact;
        await newMember.save({ session });

        // 3. Update Transaction Record
        transaction.amount = newAmount;
        transaction.fundId = fundId;
        transaction.memberId = memberId;
        transaction.description = description;
        transaction.date = date;
        transaction.handlingOfficer = cashierName;
        transaction.depositMethod = depositMethod;
        // transaction.shareNumber -- Transaction schema might not have this, but Member does.
        await transaction.save({ session });

        // 4. Audit Log (System Activity)
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'EDIT_DEPOSIT',
            resourceType: 'Transaction',
            resourceId: transaction._id,
            details: {
                message: `Edited deposit #${transaction._id}`,
                previous: { amount: oldAmount, fundId: oldFundId, memberId: oldMemberId },
                current: { amount: newAmount, fundId, memberId }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(transaction);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Edit deposit failed');
    } finally {
        session.endSession();
    }
});

// @desc    Approve a pending deposit
// @route   PUT /api/finance/deposits/:id/approve
// @access  Private (Admin)
const approveDeposit = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transaction = await Transaction.findById(req.params.id).session(session);

        if (!transaction) {
            res.status(404);
            throw new Error('Transaction not found');
        }

        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            res.status(400);
            throw new Error('Transaction already approved');
        }

        // Apply Financial Impact
        const fund = await Fund.findById(transaction.fundId).session(session);
        const member = await Member.findById(transaction.memberId).session(session);

        if (!fund) throw new Error('Target Fund not found');
        if (!member) throw new Error('Member not found');

        // Update Fund
        fund.balance += transaction.amount;
        await fund.save({ session });

        // Update Member
        member.totalContributed += transaction.amount;

        // Estimate Shares if applicable. Ideally this should be stored in transaction meta or recalc.
        // For simplicity, we assume 1000 BDT = 1 Share if not explicitly stored?
        // Better: Retrospectively calculate or use a passed param?
        // Current Schema doesn't store 'shareNumber' on Transaction explicitly, only description usually has it?
        // Let's assume standard logic: Amount / 1000.
        const estimatedShares = Math.floor(transaction.amount / 1000);
        member.shares += estimatedShares;

        await member.save({ session });

        // Update Transaction
        transaction.status = 'Completed';
        transaction.authorizedBy = req.user._id; // Approver
        await transaction.save({ session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(transaction);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Approval failed');
    } finally {
        session.endSession();
    }
});
// @desc    Add an expense
// @route   POST /api/finance/expenses
// @access  Private (Admin)
const addExpense = asyncHandler(async (req, res) => {
    let { amount, fundId, description, reason, category, date, projectId, memberId } = req.body;

    // Normalize description
    if (!description && reason) description = reason;
    if (!description) description = "";

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Enforce Project-Fund Integrity
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (!project) throw new Error('Project not found');

            // If the project has a linked fund, it MUST be the source fund
            if (project.linkedFundId) {
                fundId = project.linkedFundId;
            }

            // Update Project internal tracking
            project.currentFundBalance -= Number(amount);
            project.totalExpenses = (project.totalExpenses || 0) + Number(amount);
            await project.save({ session });

            // Enrich description with project context
            if (description && typeof description === 'string' && !description.includes(`[${project.title}]`)) {
                description = `[${project.title}] ${description}`;
            }
        }

        const fund = await Fund.findById(fundId).session(session);
        if (!fund) throw new Error('Source Fund not found');

        // Prevent using project funds for non-project expenses
        if (!projectId && fund.type === 'PROJECT') {
            throw new Error('Project-specific funds cannot be used for general expenses. Please select a project first.');
        }

        if (fund.balance < amount) {
            throw new Error('Insufficient balance in ' + fund.name);
        }

        // Update Fund
        fund.balance -= Number(amount);
        await fund.save({ session });

        // Create Transaction
        const transaction = await Transaction.create([{
            type: 'Expense',
            amount: Number(amount),
            description: description,
            category: category || 'Operational',
            fundId,
            projectId,
            memberId, // Added memberId
            date: date || Date.now(),
            status: 'Success',
            authorizedBy: req.user._id
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(201).json(transaction[0]);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Expense failed');
    } finally {
        session.endSession();
    }
});

// @desc    Add an earning (General Income / Interest)
// @route   POST /api/finance/earnings
// @access  Private (Admin)
const addEarning = asyncHandler(async (req, res) => {
    const { amount, fundId, description, category, date, projectId, memberId } = req.body;

    if (!amount || Number(amount) <= 0) {
        res.status(400);
        throw new Error('Invalid earning amount');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const fund = await Fund.findById(fundId).session(session);
        if (!fund) throw new Error('Target Fund not found');

        // Update Fund
        fund.balance += Number(amount);
        await fund.save({ session });

        // Update Project if linked (though projectController has its own, this provides synergy)
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (project) {
                project.currentFundBalance += Number(amount);
                project.totalEarnings += Number(amount);
                await project.save({ session });
            }
        }

        // Create Transaction
        const transaction = await Transaction.create([{
            type: 'Earning',
            amount: Number(amount),
            description: description || 'General Earning',
            category: category || 'Income',
            fundId,
            projectId,
            memberId,
            date: date || Date.now(),
            status: 'Success',
            authorizedBy: req.user._id
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(201).json(transaction[0]);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Earning record failed');
    } finally {
        session.endSession();
    }
});

// @desc    Delete transaction
// @route   DELETE /api/finance/transactions/:id
// @access  Private (Admin)
const deleteTransaction = asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transaction = await Transaction.findById(req.params.id).session(session);

        if (!transaction) {
            res.status(404);
            throw new Error('Transaction not found');
        }

        // Only reverse impact if it was actually applied (Success/Completed)
        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            const amount = transaction.amount;
            const fundId = transaction.fundId;
            const projectId = transaction.projectId;
            const memberId = transaction.memberId;

            // 1. Revert Fund Balance
            if (fundId) {
                const fund = await Fund.findById(fundId).session(session);
                if (fund) {
                    if (['Deposit', 'Earning', 'Investment'].includes(transaction.type)) {
                        fund.balance -= amount;
                    } else if (['Withdrawal', 'Expense', 'Dividend'].includes(transaction.type)) {
                        fund.balance += amount;
                    }
                    await fund.save({ session });
                }
            }

            // 2. Revert Member Contributions/Shares
            if (memberId && transaction.type === 'Deposit') {
                const member = await Member.findById(memberId).session(session);
                if (member) {
                    member.totalContributed -= amount;
                    // Revert shares estimate (1000 per share as seen in current code)
                    const estimatedShares = Math.floor(amount / 1000);
                    member.shares = Math.max(0, member.shares - estimatedShares);
                    await member.save({ session });
                }
            }

            // 3. Revert Project Tracking
            if (projectId) {
                const project = await Project.findById(projectId).session(session);
                if (project) {
                    if (transaction.type === 'Earning') {
                        project.currentFundBalance -= amount;
                        project.totalEarnings -= amount;
                    } else if (transaction.type === 'Expense') {
                        project.currentFundBalance += amount;
                        project.totalExpenses = Math.max(0, (project.totalExpenses || 0) - amount);
                    } else if (transaction.type === 'Investment') {
                        project.currentFundBalance -= amount;
                    } else if (transaction.type === 'Withdrawal') {
                        project.currentFundBalance += amount;
                    }
                    await project.save({ session });
                }
            }
        }

        // Archive the deleted record
        await DeletedRecord.create([{
            originalId: transaction._id,
            collectionName: 'Transaction',
            data: transaction.toObject(),
            deletedBy: req.user._id,
            reason: req.body.reason || 'Manual Deletion'
        }], { session });

        await transaction.deleteOne({ session });

        await session.commitTransaction();
        await recalculateAllStats();

        // Audit Log
        await logAudit({
            req,
            user: req.user,
            action: 'DELETE_TRANSACTION',
            resourceType: 'Transaction',
            resourceId: transaction._id,
            details: { originalAmount: transaction.amount, reason: req.body.reason || 'Manual Deletion' }
        });

        res.json({ message: 'Transaction removed' });
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error('Delete failed: ' + error.message);
    } finally {
        session.endSession();
    }
});

// @desc    Transfer funds
// @route   POST /api/finance/transfer
// @access  Private (Admin)
const transferFunds = asyncHandler(async (req, res) => {
    const { sourceFundId, targetFundId, amount, description } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const sourceFund = await Fund.findById(sourceFundId).session(session);
        const targetFund = await Fund.findById(targetFundId).session(session);

        if (!sourceFund || !targetFund) {
            throw new Error('Fund not found');
        }

        if (sourceFund.balance < amount) {
            throw new Error('Insufficient source balance');
        }

        // Debit Source
        sourceFund.balance -= Number(amount);
        await sourceFund.save({ session });

        // Credit Target
        targetFund.balance += Number(amount);
        await targetFund.save({ session });

        // Record Transaction
        const transaction = await Transaction.create([{
            type: 'Investment',
            amount: Number(amount),
            description: description || `Transfer from ${sourceFund.name} to ${targetFund.name}`,
            fundId: targetFundId, // Technically this is an internal transfer, might need better schema support
            authorizedBy: req.user._id
        }], { session });

        await session.commitTransaction();

        // Audit Log
        await logAudit({
            req,
            user: req.user,
            action: 'TRANSFER_FUNDS',
            resourceType: 'Fund',
            resourceId: targetFundId,
            details: { amount, sourceFundId, targetFundId, description }
        });

        res.status(201).json(transaction[0]);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Transfer failed');
    } finally {
        session.endSession();
    }
});


// @desc    Distribute Dividends (Project or Global)
// @route   POST /api/finance/dividends
// @access  Private (Admin)
const distributeDividends = asyncHandler(async (req, res) => {
    const { type, amount, projectId, sourceFundId, description } = req.body;

    if (!amount || amount <= 0) {
        res.status(400);
        throw new Error('Invalid dividend amount');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const members = await Member.find({ status: 'active' }).session(session);
        const totalShares = members.reduce((sum, m) => sum + m.shares, 0);

        if (totalShares === 0) throw new Error('No active shares found for distribution');

        // Check source fund/project balance
        if (type === 'Project') {
            const project = await Project.findById(projectId).session(session);
            if (!project) throw new Error('Project not found');
            if (project.currentFundBalance < amount) throw new Error('Insufficient project fund balance');
            project.currentFundBalance -= amount;
            await project.save({ session });
        } else {
            const fund = await Fund.findById(sourceFundId).session(session);
            if (!fund) throw new Error('Source fund not found');
            if (fund.balance < amount) throw new Error('Insufficient fund balance');
            fund.balance -= amount;
            await fund.save({ session });
        }

        const payoutRecords = [];
        for (const member of members) {
            const memberReward = (member.shares / totalShares) * amount;
            if (memberReward <= 0) continue;

            const tx = await Transaction.create([{
                type: 'Dividend',
                amount: memberReward,
                description: description || `Dividend Distribution: ${type} - ${projectId || 'Global'}`,
                memberId: member._id,
                projectId: type === 'Project' ? projectId : null,
                date: Date.now(),
                status: 'Success',
                authorizedBy: req.user._id
            }], { session });

            payoutRecords.push(tx[0]);
        }

        await session.commitTransaction();
        res.status(201).json({ message: 'Dividends distributed successfully', count: payoutRecords.length });
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message);
    } finally {
        session.endSession();
    }
});

// @desc    Transfer Equity (Member Discontinuation)
// @route   POST /api/finance/equity/transfer
// @access  Private (Admin)
const transferEquity = asyncHandler(async (req, res) => {
    const { fromMemberId, transfers, reason } = req.body; // transfers: [{ toMemberId, amount, shares }]

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const sourceMember = await Member.findById(fromMemberId).session(session);
        if (!sourceMember) throw new Error('Source member not found');

        const totalBeingTransferred = transfers.reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const totalSharesTransferred = transfers.reduce((sum, t) => sum + Number(t.shares || 0), 0);

        if (totalBeingTransferred > sourceMember.totalContributed) {
            throw new Error('Transfer amount exceeds member contribution');
        }
        if (totalSharesTransferred > sourceMember.shares) {
            throw new Error('Transfer shares exceed member holdings');
        }

        for (const t of transfers) {
            const targetMember = await Member.findById(t.toMemberId).session(session);
            if (!targetMember) throw new Error(`Target member ${t.toMemberId} not found`);

            targetMember.totalContributed += Number(t.amount);
            targetMember.shares += Number(t.shares);
            await targetMember.save({ session });

            // Record the transfer for the recipient
            await Transaction.create([{
                type: 'Equity-Transfer',
                amount: Number(t.amount),
                description: `Equity Received from ${sourceMember.name}: ${reason}`,
                memberId: targetMember._id,
                date: Date.now(),
                status: 'Success',
                authorizedBy: req.user._id
            }], { session });
        }

        // Deduct from source
        sourceMember.totalContributed -= totalBeingTransferred;
        sourceMember.shares -= totalSharesTransferred;

        if (sourceMember.totalContributed === 0 && sourceMember.shares === 0) {
            sourceMember.status = 'inactive';
        }
        await sourceMember.save({ session });

        // Record the transfer for the source
        await Transaction.create([{
            type: 'Equity-Transfer',
            amount: totalBeingTransferred,
            description: `Equity Transferred to Others: ${reason}`,
            memberId: sourceMember._id,
            date: Date.now(),
            status: 'Success',
            authorizedBy: req.user._id
        }], { session });

        await session.commitTransaction();
        res.status(200).json({ message: 'Equity transfer completed successfully' });
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message);
    } finally {
        session.endSession();
    }
});
// @desc    Edit an expense
// @route   PUT /api/finance/expenses/:id
// @access  Private (Admin/Manager)
const editExpense = asyncHandler(async (req, res) => {
    const { id } = req.params;
    let { amount, fundId, description, reason, category, date, projectId, memberId } = req.body;

    // Normalize description
    if (!description && reason) description = reason;
    if (!description) description = "";

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transaction = await Transaction.findById(id).session(session);
        if (!transaction) {
            res.status(404);
            throw new Error('Transaction not found');
        }

        if (transaction.type !== 'Expense') {
            res.status(400);
            throw new Error('Transaction is not an expense');
        }

        const oldAmount = transaction.amount;
        const oldFundId = transaction.fundId;
        const oldProjectId = transaction.projectId;
        const newAmount = Number(amount);

        // 1. Revert Old Impact
        if (oldProjectId) {
            const oldProject = await Project.findById(oldProjectId).session(session);
            if (oldProject) {
                oldProject.currentFundBalance += oldAmount;
                oldProject.totalExpenses = Math.max(0, (oldProject.totalExpenses || 0) - oldAmount);
                await oldProject.save({ session });
            }
        }

        const oldFund = await Fund.findById(oldFundId).session(session);
        if (oldFund) {
            oldFund.balance += oldAmount;
            await oldFund.save({ session });
        }

        // 2. Apply New Impact
        // Enforce Project-Fund Integrity for new data
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (!project) throw new Error('New project not found');

            if (project.linkedFundId) {
                fundId = project.linkedFundId;
            }

            project.currentFundBalance -= newAmount;
            project.totalExpenses = (project.totalExpenses || 0) + newAmount;
            await project.save({ session });

            if (description && typeof description === 'string' && !description.includes(`[${project.title}]`)) {
                description = `[${project.title}] ${description}`;
            }
        }

        const newFund = await Fund.findById(fundId).session(session);
        if (!newFund) throw new Error('New source fund not found');

        if (!projectId && newFund.type === 'PROJECT') {
            throw new Error('Project-specific funds cannot be used for general expenses.');
        }

        if (newFund.balance < newAmount) {
            throw new Error('Insufficient balance in ' + newFund.name);
        }

        newFund.balance -= newAmount;
        await newFund.save({ session });

        // 3. Update Transaction Record
        transaction.amount = newAmount;
        transaction.fundId = fundId;
        transaction.projectId = projectId;
        transaction.memberId = memberId;
        transaction.description = description;
        transaction.category = category;
        transaction.date = date || transaction.date;
        await transaction.save({ session });

        // 4. Audit Log
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'EDIT_EXPENSE',
            resourceType: 'Transaction',
            resourceId: transaction._id,
            details: {
                message: `Edited expense #${transaction._id}`,
                previous: { amount: oldAmount, fundId: oldFundId, projectId: oldProjectId },
                current: { amount: newAmount, fundId, projectId }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(transaction);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Edit expense failed');
    } finally {
        session.endSession();
    }
});

export {
    getTransactions,
    addDeposit,
    addExpense,
    addEarning,
    transferFunds,
    deleteTransaction,
    approveDeposit,
    distributeDividends,
    transferEquity,
    editDeposit,
    editExpense
};


