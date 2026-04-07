import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import Member from '../models/Member.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Project from '../models/Project.js';
import { v4 as uuidv4 } from 'uuid';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { recalculateAllStats } from './analyticsController.js';
import SystemSettings from '../models/SystemSettings.js';

const SUCCESSFUL_DEPOSIT_STATUSES = ['Success', 'Completed'];

const attachSuccessfulDepositTotals = async (members) => {
    if (!members.length) return members;

    const memberIds = members.map(member => member._id);
    const depositStats = await Transaction.aggregate([
        {
            $match: {
                type: 'Deposit',
                status: { $in: SUCCESSFUL_DEPOSIT_STATUSES },
                memberId: { $in: memberIds }
            }
        },
        {
            $group: {
                _id: '$memberId',
                successfulDepositTotal: { $sum: '$amount' }
            }
        }
    ]);

    const depositMap = new Map(depositStats.map(stat => [stat._id.toString(), stat.successfulDepositTotal]));

    return members.map(member => ({
        ...member,
        successfulDepositTotal: depositMap.get(member._id.toString()) || 0
    }));
};

// @desc Get all members
// @route GET /api/members
// @access Private
const getMembers = asyncHandler(async (req, res) => {
    const { page, limit, skip, sortOptions } = getPaginationParams(req.query, {
        sortBy: 'name',
        sortOrder: 'asc'
    });
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

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

    const totalCountPromise = Member.countDocuments(query);

    let members;
    if (sortBy === 'successfulDepositTotal' || sortBy === 'totalContributed') {
        members = await Member.aggregate([
            { $match: query },
            {
                $lookup: {
                    from: 'transactions',
                    let: { memberObjectId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$memberId', '$$memberObjectId'] },
                                        { $eq: ['$type', 'Deposit'] },
                                        { $in: ['$status', SUCCESSFUL_DEPOSIT_STATUSES] }
                                    ]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                successfulDepositTotal: { $sum: '$amount' }
                            }
                        }
                    ],
                    as: 'depositStats'
                }
            },
            {
                $addFields: {
                    successfulDepositTotal: {
                        $ifNull: [{ $arrayElemAt: ['$depositStats.successfulDepositTotal', 0] }, 0]
                    }
                }
            },
            { $project: { __v: 0, depositStats: 0 } },
            { $sort: { successfulDepositTotal: sortOrder, name: 1 } },
            { $skip: skip },
            { $limit: limit }
        ]);
    } else {
        const rawMembers = await Member.find(query)
            .lean()
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .select('-__v');

        members = await attachSuccessfulDepositTotals(rawMembers);
    }

    const totalCount = await totalCountPromise;

    res.json(formatPaginatedResponse(members, page, limit, totalCount));
});

// @desc Get member by ID
// @route GET /api/members/:id
// @access Private
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

// @desc Create a member
// @route POST /api/members
// @access Private/Admin
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

    const settings = await SystemSettings.findOne() || { financial: { shareValueBdt: 1000 } };
    const shareValue = settings.financial?.shareValueBdt || 1000;

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
        totalContributed: (Number(shares) || 0) * shareValue,
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

// @desc Update member
// @route PUT /api/members/:id
// @access Private/Admin
const updateMember = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id);

    if (member) {
        // SHARES CAN ALWAYS BE EDITED FROM MEMBERS SCREEN
        if (req.body.shares !== undefined) {
            member.shares = Number(req.body.shares);
        }

        // totalContributed can also be updated
        if (req.body.totalContributed !== undefined) {
            member.totalContributed = Number(req.body.totalContributed);
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

// @desc Delete member
// @route DELETE /api/members/:id
// @access Private/Admin
const deleteMember = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id);

    if (!member) {
        res.status(404);
        throw new Error('Member not found');
    }

    // Enterprise Grade: Check for ANY related data before hard delete
    const transactionCount = await Transaction.countDocuments({ memberId: req.params.id });
    if (transactionCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member has ${transactionCount} financial record${transactionCount > 1 ? 's' : ''}. Set the member to inactive instead.`);
    }

    const projectCount = await Project.countDocuments({
        'involvedMembers.memberId': req.params.id
    });
    if (projectCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member is linked to ${projectCount} project${projectCount > 1 ? 's' : ''}. Remove the member from those projects first.`);
    }

    const linkedUser = await User.findOne({ $or: [{ _id: member.userId }, { memberId: member.memberId }] });
    if (linkedUser) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member still has system access. Remove the linked user account first.`);
    }

    await member.deleteOne();
    await recalculateAllStats();
    res.json({ message: 'Member successfully removed' });
});

// @desc Onboard a new member with system access in one go
// @route POST /api/members/onboard
// @access Private/Admin
const onboardMember = asyncHandler(async (req, res) => {
    const { name, email, phone, role, status, shares, systemAccess, password, userRole } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const settings = await SystemSettings.findOne().session(session) || { financial: { shareValueBdt: 1000 } };
        const shareValue = settings.financial?.shareValueBdt || 1000;

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
            totalContributed: (Number(shares) || 0) * shareValue,
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

// @desc Recalculate financial totals for all members based on transaction history
// @route POST /api/members/recalculate-financials
// @access Private/Admin
const recalculateMemberFinancials = asyncHandler(async (req, res) => {
    // FIXED: Now accounts for withdrawals, dividends, and other deductions

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
                totalDeposited: { $sum: '$amount' }
            }
        }
    ]);

    // 2. Aggregate all withdrawals/deductions by member
    const withdrawalStats = await Transaction.aggregate([
        {
            $match: {
                type: { $in: ['Withdrawal', 'Dividend'] },
                status: { $in: ['Success', 'Completed'] }
            }
        },
        {
            $group: {
                _id: '$memberId',
                totalWithdrawn: { $sum: '$amount' }
            }
        }
    ]);

    // 3. Create maps for quick lookup
    const depositMap = new Map(depositStats.map(s => [s._id.toString(), s.totalDeposited]));
    const withdrawalMap = new Map(withdrawalStats.map(s => [s._id.toString(), s.totalWithdrawn]));

    // 4. Get all members who have any transactions
    const allMemberIds = [...new Set([
        ...depositStats.map(s => s._id.toString()),
        ...withdrawalStats.map(s => s._id.toString())
    ])];

    // 5. Prepare Bulk Update Operations (FIXED: Now accounts for withdrawals)
    const bulkOps = allMemberIds.map(memberId => {
        const totalDeposited = depositMap.get(memberId) || 0;
        const totalWithdrawn = withdrawalMap.get(memberId) || 0;
        const netContributed = Math.max(0, totalDeposited - totalWithdrawn);

        return {
            updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(memberId) },
                update: {
                    $set: {
                        totalContributed: netContributed
                    }
                }
            }
        };
    });

    // 6. Execute Bulk Write
    if (bulkOps.length > 0) {
        // Process in chunks to avoid MongoDB document size limits
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
            const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
            await Member.bulkWrite(chunk);
        }
    }

    // 7. Handle members with NO transactions (reset to 0)
    await Member.updateMany(
        { _id: { $nin: allMemberIds.map(id => new mongoose.Types.ObjectId(id)) } },
        { $set: { totalContributed: 0 } }
    );

    await recalculateAllStats(); // Update global stats too

    res.json({
        message: 'Financials recalculated successfully',
        membersUpdated: allMemberIds.length,
        details: {
            membersWithDeposits: depositStats.length,
            membersWithWithdrawals: withdrawalStats.length
        }
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
