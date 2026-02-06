import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import Member from '../models/Member.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Project from '../models/Project.js';
import { v4 as uuidv4 } from 'uuid';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { recalculateAllStats } from './analyticsController.js';

// @desc    Get all members
// @route   GET /api/members
// @access  Private
const getMembers = asyncHandler(async (req, res) => {
    const { page, limit, skip, sortOptions } = getPaginationParams(req.query, {
        sortBy: 'name',
        sortOrder: 'asc'
    });
    const search = req.query.search || '';

    // Create search filter using text index or regex
    const query = search
        ? {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { memberId: { $regex: search, $options: 'i' } }
            ]
        }
        : {};

    // For enterprise grade, we might want to filter by status or role too
    if (req.query.status) query.status = req.query.status;
    if (req.query.role) query.role = req.query.role;

    const totalCount = await Member.countDocuments(query);
    const members = await Member.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email')
        .populate('userId', 'name email lastLogin');

    res.json(formatPaginatedResponse(members, page, limit, totalCount));
});

// @desc    Get member by ID
// @route   GET /api/members/:id
// @access  Private
const getMemberById = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id)
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email')
        .populate('userId', 'name email lastLogin');

    if (member) {
        res.json(member);
    } else {
        res.status(404);
        throw new Error('Member not found');
    }
});

// @desc    Create a member
// @route   POST /api/members
// @access  Private/Admin
const createMember = asyncHandler(async (req, res) => {
    const { name, email, phone, memberId, role, status, shares } = req.body;

    if (!name || !email || !phone) {
        res.status(400);
        throw new Error('Name, Email and Phone are required');
    }

    const memberExists = await Member.findOne({ email });
    if (memberExists) {
        res.status(400);
        throw new Error('Member already exists with this email');
    }

    // Role-based ID generation: Ensure uniqueness
    let finalMemberId = memberId;
    if (!finalMemberId) {
        const count = await Member.countDocuments();
        finalMemberId = `MEM-${(count + 1).toString().padStart(4, '0')}`;
    }

    const idExists = await Member.findOne({ memberId: finalMemberId });
    if (idExists) {
        // If provided id exists, generate a unique one as fallback or error
        finalMemberId = `MEM-${uuidv4().substring(0, 8).toUpperCase()}`;
    }

    const member = await Member.create({
        memberId: finalMemberId,
        name,
        email,
        phone,
        role: role || 'Member',
        status: status || 'active',
        lastActive: new Date(),
        // Initial balance allowed only on creation, thereafter must use transactions
        shares: Number(shares) || 0,
        totalContributed: (Number(shares) || 0) * 1000, // assuming 1000 per share
        createdBy: req.user?._id,
        updatedBy: req.user?._id
    });

    if (member) {
        await recalculateAllStats();
        res.status(201).json(member);
    } else {
        res.status(400);
        throw new Error('Invalid member data');
    }
});

// @desc    Update member
// @route   PUT /api/members/:id
// @access  Private/Admin
const updateMember = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id);

    if (member) {
        // Security Check: If modifying sensitive fields, verify permissions or log it
        const isModifyingCapital = (req.body.shares !== undefined && Number(req.body.shares) !== member.shares) ||
            (req.body.totalContributed !== undefined && Number(req.body.totalContributed) !== member.totalContributed);

        if (isModifyingCapital) {
            const hasTransactions = await Transaction.exists({
                memberId: req.params.id,
                type: { $in: ['Deposit', 'Investment', 'Expense'] }
            });

            if (hasTransactions) {
                res.status(400);
                throw new Error('Cannot modify shares/capital manually for members with transaction history. Use formal transactions.');
            }

            member.shares = Number(req.body.shares) || member.shares;
            member.totalContributed = Number(req.body.totalContributed) || member.totalContributed;
        }

        // Standard updates
        member.name = req.body.name || member.name;
        member.email = req.body.email || member.email;
        member.phone = req.body.phone || member.phone;
        member.role = req.body.role || member.role;
        member.status = req.body.status || member.status;
        member.updatedBy = req.user?._id;

        const updatedMember = await member.save();
        await recalculateAllStats();
        res.json(updatedMember);
    } else {
        res.status(404);
        throw new Error('Member not found');
    }
});

// @desc    Delete member
// @route   DELETE /api/members/:id
// @access  Private/Admin
const deleteMember = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id);

    if (!member) {
        res.status(404);
        throw new Error('Member not found');
    }

    // Enterprise Grade: Check for ANY related data before hard delete
    const hasHistory = await Transaction.exists({ memberId: req.params.id });
    if (hasHistory) {
        res.status(400);
        throw new Error('Cannot delete member with financial history. Deactivate them instead.');
    }

    const involvedInProjects = await Project.exists({
        'involvedMembers.memberId': req.params.id
    });
    if (involvedInProjects) {
        res.status(400);
        throw new Error('Cannot delete member involved in projects.');
    }

    await member.deleteOne();
    await recalculateAllStats();
    res.json({ message: 'Member successfully removed' });
});

// @desc    Onboard a new member with system access in one go
// @route   POST /api/members/onboard
// @access  Private/Admin
const onboardMember = asyncHandler(async (req, res) => {
    const { name, email, phone, role, status, shares, systemAccess, password, userRole } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Create Member
        const count = await Member.countDocuments({}, { session });
        const memberId = `MEM-${(count + 1).toString().padStart(4, '0')}`;

        const member = await Member.create([{
            memberId,
            name,
            email,
            phone,
            role: role || 'Member',
            status: status || 'active',
            shares: Number(shares) || 0,
            totalContributed: (Number(shares) || 0) * 1000,
            createdBy: req.user?._id,
            updatedBy: req.user?._id,
            hasUserAccess: systemAccess
        }], { session });

        // 2. If system access, create User
        if (systemAccess) {
            if (!password || password.length < 6) {
                throw new Error('Password is required for system access (min 6 chars)');
            }

            const userExists = await User.findOne({ email }).session(session);
            if (userExists) {
                throw new Error('User account already exists with this email');
            }

            const user = await User.create([{
                name,
                email,
                phone,
                password,
                role: userRole || 'Member',
                memberId: memberId,
                permissions: {} // Default empty permissions Map handled by schema
            }], { session });

            // Link user back to member
            member[0].userId = user[0]._id;
            await member[0].save({ session });
        }

        await session.commitTransaction();
        await recalculateAllStats();

        res.status(201).json(member[0]);
    } catch (error) {
        await session.abortTransaction();
        res.status(error.message.includes('required') || error.message.includes('exists') ? 400 : 500);
        throw error;
    } finally {
        session.endSession();
    }
});

// @desc    Recalculate financial totals for all members based on transaction history
// @route   POST /api/members/recalculate-financials
// @access  Private/Admin
const recalculateMemberFinancials = asyncHandler(async (req, res) => {
    // 1. Aggregate all deposits by member
    const depositStats = await Transaction.aggregate([
        {
            $match: {
                type: 'Deposit',
                status: { $in: ['Success', 'Completed'] }
            }
        },
        {
            $group: {
                _id: '$memberId',
                totalDeposited: { $sum: '$amount' },
                // If we want to strictly recalculate shares based on history, we can sum shareNumber if available, or amount/1000
                // Current logic seems to rely on manual shareNumber sometimes.
                // Best effort: If we have shareNumber in transaction (we added it in AddDeposit), sum it.
                // But schema might not strictly enforce shareNumber on all past transactions.
                // Let's stick to totalContributed fix primarily as requested.
            }
        }
    ]);

    // 2. Prepare Bulk Update Operations
    const bulkOps = depositStats.map(stat => ({
        updateOne: {
            filter: { _id: stat._id },
            update: {
                $set: {
                    totalContributed: stat.totalDeposited,
                    // Optional: Recalculate shares? 
                    // Risk: If manual adjustments were made to shares without transactions, this overrides them.
                    // User complained about "Total Deposit" specifically. Let's fix that first.
                    // shares: Math.floor(stat.totalDeposited / 1000) 
                }
            }
        }
    }));

    // 3. Execute Bulk Write
    if (bulkOps.length > 0) {
        await Member.bulkWrite(bulkOps);
    }

    // 4. Handle members with NO deposits (reset to 0)
    const memberIdsWithDeposits = depositStats.map(s => s._id);
    await Member.updateMany(
        { _id: { $nin: memberIdsWithDeposits } },
        { $set: { totalContributed: 0 } }
    );

    await recalculateAllStats(); // Update global stats too

    res.json({
        message: 'Financials recalculated successfully',
        count: bulkOps.length
    });
});

export {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
    onboardMember,
    recalculateMemberFinancials
};
