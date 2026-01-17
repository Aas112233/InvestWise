import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Fund from '../models/Fund.js';
import Member from '../models/Member.js';
import Project from '../models/Project.js';
import DeletedRecord from '../models/DeletedRecord.js';

// @desc    Get all transactions
// @route   GET /api/finance/transactions
// @access  Private
const getTransactions = asyncHandler(async (req, res) => {
    const transactions = await Transaction.find({})
        .populate('memberId', 'name email')
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort({ date: -1 });
    res.json(transactions);
});

// @desc    Add a deposit
// @route   POST /api/finance/deposits
// @access  Private (Admin/Manager)
// @desc    Add a deposit (Direct or Request)
// @route   POST /api/finance/deposits
// @access  Private (Admin/Manager)
const addDeposit = asyncHandler(async (req, res) => {
    console.log('DEBUG addDeposit body:', req.body);
    const { memberId, amount, fundId, description, date, shareNumber, status, cashierName, handlingOfficer } = req.body;

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
            handlingOfficer: cashierName || handlingOfficer // Save the officer name
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
    const { amount, fundId, description, category, date, projectId } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const fund = await Fund.findById(fundId).session(session);
        if (!fund) throw new Error('Fund not found');

        if (fund.balance < amount) {
            throw new Error('Insufficient funds');
        }

        // Update Fund
        fund.balance -= Number(amount);
        await fund.save({ session });

        // Update Project if applicable
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (project) {
                project.currentFundBalance -= Number(amount);
                await project.save({ session });
            }
        }

        // Create Transaction
        const transaction = await Transaction.create([{
            type: 'Expense',
            amount: Number(amount),
            description: category ? `${category}: ${description}` : description,
            fundId,
            projectId,
            date: date || Date.now(),
            status: 'Success',
            authorizedBy: req.user._id
        }], { session });

        await session.commitTransaction();
        res.status(201).json(transaction[0]);
    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Expense failed');
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
            if (transaction.type === 'Deposit') {
                const fund = await Fund.findById(transaction.fundId).session(session);
                const member = await Member.findById(transaction.memberId).session(session);

                if (fund) {
                    fund.balance -= transaction.amount;
                    await fund.save({ session });
                }
                if (member) {
                    member.totalContributed -= transaction.amount;
                    // Revert shares estimate
                    const estimatedShares = Math.floor(transaction.amount / 1000);
                    member.shares = Math.max(0, member.shares - estimatedShares);
                    await member.save({ session });
                }
            } else if (transaction.type === 'Expense') {
                const fund = await Fund.findById(transaction.fundId).session(session);
                if (fund) {
                    fund.balance += transaction.amount;
                    await fund.save({ session });
                }
                if (transaction.projectId) {
                    const project = await Project.findById(transaction.projectId).session(session);
                    if (project) {
                        project.currentFundBalance += transaction.amount;
                        await project.save({ session });
                    }
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

export {
    getTransactions,
    addDeposit,
    addExpense,
    transferFunds,
    deleteTransaction,
    approveDeposit,
    distributeDividends,
    transferEquity
};

