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
    const { page, limit, skip, sortOptions } = getPaginationParams(req.query, {
        sortBy: 'date',
        sortOrder: 'desc'
    });
    const search = req.query.search || '';
    const searchField = req.query.searchField || 'all';

    let query = {};

    // Create search filter
    if (search) {
        if (searchField === 'amount') {
            const num = Number(search);
            if (!isNaN(num)) query.amount = num;
        } else if (searchField === 'id') {
            // Try to match _id or referenceNumber or partial ID string
            if (mongoose.Types.ObjectId.isValid(search)) {
                query._id = search;
            } else {
                // partial hex match or ref number
                query.$or = [
                    { referenceNumber: { $regex: search, $options: 'i' } }
                ];
                // If it looks like a hex string but maybe not full 24 chars, we can't regex _id easily in standard mongo 
                // without $toString in aggregation. For now valid ObjectId exact match or Reference Number regex.
                // We can also allow filtering by string ID if stored as string? No, _id is ObjectId.
            }
        } else if (searchField === 'memberId') {
            const members = await Member.find({ memberId: { $regex: search, $options: 'i' } }).select('_id');
            query.memberId = { $in: members.map(m => m._id) };
        } else if (searchField === 'memberName') {
            const members = await Member.find({ name: { $regex: search, $options: 'i' } }).select('_id');
            query.memberId = { $in: members.map(m => m._id) };
        } else if (searchField === 'fundName') {
            const funds = await Fund.find({ name: { $regex: search, $options: 'i' } }).select('_id');
            query.fundId = { $in: funds.map(f => f._id) };
        } else {
            // 'all'
            const memberMatches = await Member.find({
                $or: [{ name: { $regex: search, $options: 'i' } }, { memberId: { $regex: search, $options: 'i' } }]
            }).select('_id');

            const fundMatches = await Fund.find({ name: { $regex: search, $options: 'i' } }).select('_id');

            const orConditions = [
                { type: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { status: { $regex: search, $options: 'i' } },
                { referenceNumber: { $regex: search, $options: 'i' } },
                { memberId: { $in: memberMatches.map(m => m._id) } },
                { fundId: { $in: fundMatches.map(f => f._id) } }
            ];

            if (!isNaN(search)) {
                orConditions.push({ amount: Number(search) });
            }
            if (mongoose.Types.ObjectId.isValid(search)) {
                orConditions.push({ _id: search });
            }

            query.$or = orConditions;
        }
    }

    // Allow filtering by type and status if provided
    if (req.query.type) query.type = req.query.type;
    if (req.query.status) query.status = req.query.status;

    const totalCount = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
        .populate('memberId', 'memberId name email')
        .populate('projectId', 'title')
        .populate('fundId', 'name')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);

    // Calculate totals for inflow and outflow (agnostic of pagination)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const totals = await Transaction.aggregate([
        {
            $match: {
                ...query,
                status: { $in: ['Success', 'Completed', 'Processing'] }
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
                },
                totalMonthly: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $in: ['$type', ['Deposit', 'Earning', 'Investment']] },
                                    { $gte: ['$date', startOfMonth] }
                                ]
                            },
                            '$amount',
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const stats = totals[0] || { totalInflow: 0, totalOutflow: 0, totalMonthly: 0 };

    res.json({
        ...formatPaginatedResponse(transactions, page, limit, totalCount),
        totalInflow: stats.totalInflow,
        totalOutflow: stats.totalOutflow,
        totalMonthly: stats.totalMonthly
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
        const fund = await Fund.findById(fundId).session(session);
        const member = await Member.findById(memberId).session(session);
        if (!fund || !member) throw new Error('Fund or Member not found');

        const balanceBefore = fund.balance;

        // 1. Create Transaction Record
        const transaction = await Transaction.create([{
            type: 'Deposit',
            amount: Number(amount),
            description: description,
            memberId,
            fundId,
            date: date || Date.now(),
            status: status || 'Completed', // Default to Completed if not specified
            authorizedBy: req.user._id,
            createdBy: req.user._id,
            updatedBy: req.user._id,
            handlingOfficer: req.user.name || cashierName || handlingOfficer || 'System',
            depositMethod: depositMethod || 'Cash',
            referenceNumber: req.body.referenceNumber,
            balanceBefore: balanceBefore,
            balanceAfter: (status === 'Success' || status === 'Completed') ? (balanceBefore + Number(amount)) : balanceBefore
        }], { session });

        // Apply financial impact if Success
        if (status === 'Success' || status === 'Completed') {
            // Update Fund
            fund.balance += Number(amount);
            await fund.save({ session });

            // Update Member
            member.totalContributed += Number(amount);
            // member.shares is a static property, DO NOT increment it via deposits
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
        const oldStatus = transaction.status;
        const isCompleted = oldStatus === 'Success' || oldStatus === 'Completed';

        // 1. Revert Old Impact (Only if it was previously applied)
        if (isCompleted) {
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
                // member.shares is static, do not revert
                await oldMember.save({ session });
            }
        }

        // 2. Apply New Impact (We assume edit maintains 'Completed' status or use existing)
        const newAmount = parseInt(amount);
        const newShareImpact = parseInt(shareNumber);

        // Find New Fund (even if it's the same as oldFund)
        const newFund = await Fund.findById(fundId).session(session);
        if (!newFund) throw new Error(`Target fund not found: ${fundId}`);

        // Only apply impact if the transaction is (still) in a completed state
        // If it was pending, we update the record but don't touch the fund yet
        if (isCompleted) {
            newFund.balance += newAmount;
            await newFund.save({ session });
        }

        // Find New Member (even if it's the same as oldMember)
        const newMember = await Member.findById(memberId).session(session);
        if (!newMember) throw new Error(`Target partner not found: ${memberId}`);

        if (isCompleted) {
            newMember.totalContributed += newAmount;
            // member.shares is a static property, DO NOT modify it via deposit edits
            await newMember.save({ session });
        }

        // 3. Update Transaction Record
        transaction.amount = newAmount;
        transaction.fundId = fundId;
        transaction.memberId = memberId;
        transaction.description = description;
        transaction.date = date;
        transaction.handlingOfficer = req.user.name;
        transaction.depositMethod = depositMethod;
        transaction.referenceNumber = req.body.referenceNumber;
        transaction.updatedBy = req.user._id;
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
        // member.shares is a static property, DO NOT modify it via approvals
        await member.save({ session });

        // Update Transaction
        transaction.status = 'Completed';
        transaction.authorizedBy = req.user._id;
        transaction.updatedBy = req.user._id;
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
        const fund = await Fund.findById(fundId).session(session);
        if (!fund) throw new Error('Source Fund not found');

        // Capture snapshot before impact
        let balanceBefore = fund.balance;
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (project) balanceBefore = project.currentFundBalance;
        }

        // Prevent using project funds for non-project expenses
        if (!projectId && fund.type === 'PROJECT') {
            throw new Error('Project-specific funds cannot be used for general expenses. Please select a project first.');
        }

        if (fund.balance < amount) {
            throw new Error('Insufficient balance in ' + fund.name);
        }

        // Apply Project Impact
        if (projectId) {
            const project = await Project.findById(projectId).session(session);

            // Record Balance Snapshot for the UPDATE record
            const projBalanceBefore = project.currentFundBalance;

            project.currentFundBalance -= Number(amount);
            project.totalExpenses = (project.totalExpenses || 0) + Number(amount);

            // Sync with Project Updates for visibility in Project Management
            project.updates.push({
                type: 'Expense',
                amount: Number(amount),
                description: description,
                date: date || Date.now(),
                balanceBefore: projBalanceBefore,
                balanceAfter: project.currentFundBalance
            });

            await project.save({ session });

            if (description && typeof description === 'string' && !description.includes(`[${project.title}]`)) {
                description = `[${project.title}] ${description}`;
            }
        }

        // Update Fund
        fund.balance -= Number(amount);
        await fund.save({ session });

        const balanceAfter = projectId
            ? (await Project.findById(projectId).session(session)).currentFundBalance
            : fund.balance;

        // Create Transaction
        const transaction = await Transaction.create([{
            type: 'Expense',
            amount: Number(amount),
            description: description,
            category: category || 'Operational',
            fundId,
            projectId,
            memberId,
            date: date || Date.now(),
            status: 'Success',
            authorizedBy: req.user._id,
            handlingOfficer: req.user.name,
            balanceBefore,
            balanceAfter
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

        let balanceBefore = fund.balance;
        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (project) balanceBefore = project.currentFundBalance;
        }

        // Update Fund
        fund.balance += Number(amount);
        await fund.save({ session });

        if (projectId) {
            const project = await Project.findById(projectId).session(session);
            if (project) {
                const projBalanceBefore = project.currentFundBalance;

                project.currentFundBalance += Number(amount);
                project.totalEarnings += Number(amount);

                // Sync with Project Updates
                project.updates.push({
                    type: 'Earning',
                    amount: Number(amount),
                    description: description || 'General Earning',
                    date: date || Date.now(),
                    balanceBefore: projBalanceBefore,
                    balanceAfter: project.currentFundBalance
                });

                await project.save({ session });
            }
        }

        const balanceAfter = projectId
            ? (await Project.findById(projectId).session(session)).currentFundBalance
            : fund.balance;

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
            authorizedBy: req.user._id,
            handlingOfficer: req.user.name,
            balanceBefore,
            balanceAfter
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

    if (!amount || amount <= 0) throw new Error('Transfer amount must be positive');
    if (sourceFundId === targetFundId) throw new Error('Source and Target funds must be different');

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const sourceFund = await Fund.findById(sourceFundId).session(session);
        const targetFund = await Fund.findById(targetFundId).session(session);

        if (!sourceFund || !targetFund) {
            throw new Error('One or both funds not found');
        }

        if (sourceFund.balance < amount) {
            throw new Error(`Insufficient funds in ${sourceFund.name}. Gap: ${amount - sourceFund.balance}`);
        }

        const sourceBalBefore = sourceFund.balance;
        const targetBalBefore = targetFund.balance;

        // 1. Debit Source
        sourceFund.balance -= Number(amount);
        await sourceFund.save({ session });

        // 2. Credit Target
        targetFund.balance += Number(amount);
        await targetFund.save({ session });

        // 3. Record "Out" Transaction on Source
        const outTx = await Transaction.create([{
            type: 'Withdrawal',
            amount: Number(amount),
            description: `[Transfer OUT] to ${targetFund.name}: ${description || ''}`,
            fundId: sourceFundId,
            authorizedBy: req.user._id,
            balanceBefore: sourceBalBefore,
            balanceAfter: sourceFund.balance,
            status: 'Success',
            date: Date.now()
        }], { session });

        // 4. Record "In" Transaction on Target
        const inTx = await Transaction.create([{
            type: 'Investment',
            amount: Number(amount),
            description: `[Transfer IN] from ${sourceFund.name}: ${description || ''}`,
            fundId: targetFundId,
            authorizedBy: req.user._id,
            balanceBefore: targetBalBefore,
            balanceAfter: targetFund.balance,
            status: 'Success',
            date: Date.now()
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();

        // Audit Log
        await logAudit({
            req,
            user: req.user,
            action: 'FUND_TRANSFER',
            resourceType: 'Fund',
            resourceId: targetFundId,
            details: { amount, source: sourceFund.name, target: targetFund.name, txIds: [outTx[0]._id, inTx[0]._id] }
        });

        res.status(201).json({ sourceTx: outTx[0], targetTx: inTx[0] });
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
    const { type, amount: requestedAmount, projectId, sourceFundId, description } = req.body;
    const amount = Number(requestedAmount);

    if (!amount || amount <= 0) {
        res.status(400);
        throw new Error('Invalid dividend amount');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Idempotency / Reference for the batch
        const batchId = `DIV-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

        const members = await Member.find({ status: 'active', shares: { $gt: 0 } }).session(session);
        const totalActiveShares = members.reduce((sum, m) => sum + m.shares, 0);

        if (totalActiveShares === 0) throw new Error('No active shares available for distribution');

        const ratePerShare = amount / totalActiveShares;

        // 1. Calculate precise distribution
        let totalDisbursed = 0;
        const dividendTransactions = members
            .map(member => {
                // Enterprise precision: Round down to 2 decimal places to ensure we never overbalance
                const memberReward = Math.floor((member.shares * ratePerShare) * 100) / 100;
                if (memberReward <= 0) return null;

                totalDisbursed += memberReward;

                return {
                    type: 'Dividend',
                    amount: memberReward,
                    description: description || `Dividend Distribution: ${type} Settlement [${batchId}]`,
                    memberId: member._id,
                    projectId: type === 'Project' ? projectId : null,
                    fundId: type === 'Global' ? sourceFundId : null,
                    date: Date.now(),
                    status: 'Success',
                    referenceNumber: batchId,
                    authorizedBy: req.user._id,
                    createdBy: req.user._id,
                    updatedBy: req.user._id
                };
            })
            .filter(Boolean);

        if (dividendTransactions.length === 0) throw new Error('Calculated reward per member is too small for distribution');

        // 2. Adjust Source (Project or Fund) by the ACTUAL disbursed amount
        let sourceDisplayName = '';
        if (type === 'Project') {
            const project = await Project.findById(projectId).session(session);
            if (!project) throw new Error('Target Project not found');
            if (project.currentFundBalance < totalDisbursed) {
                throw new Error(`Insufficient project balance. Required: ${totalDisbursed}, Available: ${project.currentFundBalance}`);
            }
            project.currentFundBalance -= totalDisbursed;
            sourceDisplayName = `Project: ${project.title}`;
            await project.save({ session });
        } else {
            const fund = await Fund.findById(sourceFundId).session(session);
            if (!fund) throw new Error('Source Fund not found');
            if (fund.balance < totalDisbursed) {
                throw new Error(`Insufficient fund balance. Required: ${totalDisbursed}, Available: ${fund.balance}`);
            }
            fund.balance -= totalDisbursed;
            sourceDisplayName = `Fund: ${fund.name}`;
            await fund.save({ session });
        }

        // 3. Batch insert transactions
        await Transaction.insertMany(dividendTransactions, { session });

        // 4. Audit Log
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'DISTRIBUTE_DIVIDENDS',
            resourceType: 'Finance',
            details: {
                batchId,
                type,
                requestedAmount: amount,
                actualDisbursed: totalDisbursed,
                residual: Math.max(0, amount - totalDisbursed),
                ratePerShare,
                totalActiveShares,
                recipientsCount: dividendTransactions.length,
                source: sourceDisplayName
            },
            status: 'SUCCESS'
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();

        res.status(201).json({
            success: true,
            batchId,
            message: 'Dividends distributed successfully',
            count: dividendTransactions.length,
            totalDisbursed,
            residual: amount - totalDisbursed
        });
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

    if (!fromMemberId || !transfers || !Array.isArray(transfers) || transfers.length === 0) {
        res.status(400);
        throw new Error('Invalid transfer request');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const batchId = `EQT-${Date.now()}`;
        const sourceMember = await Member.findById(fromMemberId).session(session);
        if (!sourceMember) throw new Error('Source member not found');

        const totalBeingTransferred = transfers.reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const totalSharesTransferred = transfers.reduce((sum, t) => sum + Number(t.shares || 0), 0);

        if (totalBeingTransferred > sourceMember.totalContributed) {
            throw new Error(`Insufficient contribution balance. Transfer: ${totalBeingTransferred}, Owned: ${sourceMember.totalContributed}`);
        }
        if (totalSharesTransferred > sourceMember.shares) {
            throw new Error(`Insufficient shares. Transfer: ${totalSharesTransferred}, Owned: ${sourceMember.shares}`);
        }

        const recipientTransactions = [];
        for (const t of transfers) {
            if (t.toMemberId.toString() === fromMemberId.toString()) {
                throw new Error('Self-transfer of equity is not permitted');
            }

            const targetMember = await Member.findById(t.toMemberId).session(session);
            if (!targetMember) throw new Error(`Target member ${t.toMemberId} not found`);
            if (targetMember.status !== 'active') throw new Error(`Target member ${targetMember.name} is not active`);

            targetMember.totalContributed += Number(t.amount);
            targetMember.shares += Number(t.shares);
            await targetMember.save({ session });

            // Record the transfer for the recipient
            recipientTransactions.push({
                type: 'Equity-Transfer',
                amount: Number(t.amount),
                description: `Equity Migration: Received from ${sourceMember.name} [Reference: ${reason}]`,
                memberId: targetMember._id,
                date: Date.now(),
                status: 'Success',
                referenceNumber: batchId,
                authorizedBy: req.user._id,
                createdBy: req.user._id,
                updatedBy: req.user._id
            });
        }

        if (recipientTransactions.length > 0) {
            await Transaction.insertMany(recipientTransactions, { session });
        }

        // Deduct from source
        sourceMember.totalContributed -= totalBeingTransferred;
        sourceMember.shares -= totalSharesTransferred;

        // Auto-inactivate if fully drained
        if (sourceMember.totalContributed === 0 && sourceMember.shares === 0) {
            sourceMember.status = 'inactive';
        }
        await sourceMember.save({ session });

        // Record the transfer for the source
        await Transaction.create([{
            type: 'Equity-Transfer',
            amount: totalBeingTransferred,
            description: `Equity Migration: Transferred to ${transfers.length} recipient(s) [Reference: ${reason}]`,
            memberId: sourceMember._id,
            date: Date.now(),
            status: 'Success',
            referenceNumber: batchId,
            authorizedBy: req.user._id,
            createdBy: req.user._id,
            updatedBy: req.user._id
        }], { session });

        // Audit Log
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'TRANSFER_EQUITY',
            resourceType: 'Member',
            resourceId: fromMemberId,
            details: {
                batchId,
                from: sourceMember.name,
                totalAmount: totalBeingTransferred,
                totalShares: totalSharesTransferred,
                recipients: transfers.map(t => ({ id: t.toMemberId, amount: t.amount, shares: t.shares })),
                reason
            },
            status: 'SUCCESS'
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.status(200).json({ success: true, batchId, message: 'Equity transfer completed successfully' });
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

// @desc    Reconcile Fund (Audit Balance Integrity)
// @route   POST /api/finance/funds/:id/reconcile
// @access  Private (Admin)
const reconcileFund = asyncHandler(async (req, res) => {
    const fund = await Fund.findById(req.params.id);
    if (!fund) {
        res.status(404);
        throw new Error('Fund not found');
    }

    // Aggregate all successful transactions for this fund
    const txSummary = await Transaction.aggregate([
        {
            $match: {
                fundId: fund._id,
                status: { $in: ['Success', 'Completed'] }
            }
        },
        {
            $group: {
                _id: null,
                totalIn: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['Deposit', 'Earning', 'Investment']] },
                            '$amount',
                            0
                        ]
                    }
                },
                totalOut: {
                    $sum: {
                        $cond: [
                            { $in: ['$type', ['Expense', 'Withdrawal', 'Dividend', 'Adjustment']] },
                            '$amount',
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const stats = txSummary[0] || { totalIn: 0, totalOut: 0 };
    const calculatedBalance = stats.totalIn - stats.totalOut;
    const isMatched = Math.abs(calculatedBalance - fund.balance) < 0.01;

    fund.lastReconciledAt = Date.now();
    fund.reconciliationStatus = isMatched ? 'VERIFIED' : 'DISCREPANCY';
    await fund.save();

    res.json({
        fund: fund.name,
        actualBalance: fund.balance,
        calculatedBalance,
        isMatched,
        inflow: stats.totalIn,
        outflow: stats.totalOut,
        discrepancy: calculatedBalance - fund.balance
    });
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
    editExpense,
    reconcileFund,
    bulkAddDeposits
};

// @desc    Bulk Add Deposits
// @route   POST /api/finance/deposits/bulk
// @access  Private (Admin/Manager)
const bulkAddDeposits = asyncHandler(async (req, res) => {
    const { fundId, deposits, commonMonth, cashierName } = req.body;

    if (!fundId || !deposits || !Array.isArray(deposits) || deposits.length === 0) {
        res.status(400);
        throw new Error('Invalid bulk deposit data');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const fund = await Fund.findById(fundId).session(session);
        if (!fund) throw new Error('Target fund not found');

        const batchId = `BLK-${Date.now()}`;
        const results = [];
        let totalBatchAmount = 0;

        // Track entries to prevent exact duplicates (Same Member + Same Month)
        const seenEntries = new Set();

        for (const dep of deposits) {
            const { memberId, amount, shareNumber, depositMonth } = dep;
            const month = depositMonth || commonMonth;
            const entryKey = `${memberId}-${month}`;

            if (seenEntries.has(entryKey)) {
                throw new Error(`Duplicate entry detected: Member ID ${memberId} is already in this batch for ${month}`);
            }
            seenEntries.add(entryKey);

            const member = await Member.findById(memberId).session(session);
            if (!member) throw new Error(`Member with ID ${memberId} not found`);

            const depositAmount = Number(amount);
            if (isNaN(depositAmount) || depositAmount <= 0) {
                throw new Error(`Invalid amount for member ${member.name}`);
            }

            // Update Member
            member.totalContributed += depositAmount;
            // member.shares is a static property, DO NOT increment it via bulk deposits
            await member.save({ session });

            // Create Transaction
            const transaction = await Transaction.create([{
                type: 'Deposit',
                amount: depositAmount,
                description: `Bulk Deposit [${month}]`,
                memberId: member._id,
                fundId: fund._id,
                date: Date.now(),
                status: 'Completed',
                authorizedBy: req.user._id,
                createdBy: req.user._id,
                updatedBy: req.user._id,
                handlingOfficer: req.user.name,
                depositMethod: 'Cash',
                referenceNumber: batchId,
                balanceBefore: fund.balance + totalBatchAmount,
                balanceAfter: fund.balance + totalBatchAmount + depositAmount
            }], { session });

            totalBatchAmount += depositAmount;
            results.push({
                member: member.name,
                amount: depositAmount,
                txId: transaction[0]._id
            });
        }

        // Update Fund Balance
        fund.balance += totalBatchAmount;
        await fund.save({ session });

        // Audit Log
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'BULK_DEPOSIT',
            resourceType: 'Finance',
            details: {
                batchId,
                totalAmount: totalBatchAmount,
                count: deposits.length,
                fundName: fund.name,
                month: commonMonth
            },
            status: 'SUCCESS'
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();

        res.status(201).json({
            success: true,
            batchId,
            totalAmount: totalBatchAmount,
            count: deposits.length,
            results
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Bulk Deposit Failed:', error);
        res.status(400);
        throw new Error(error.message || 'Bulk deposit failed');
    } finally {
        session.endSession();
    }
});
