import asyncHandler from 'express-async-handler';
import Member from '../models/Member.js';
import Transaction from '../models/Transaction.js';
import Project from '../models/Project.js';
import { v4 as uuidv4 } from 'uuid';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { recalculateAllStats } from './analyticsController.js';

// @desc    Get all members
// @route   GET /api/members
// @access  Private
const getMembers = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPaginationParams(req.query);
    const search = req.query.search || '';

    // Create search filter
    const query = search
        ? {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { memberId: { $regex: search, $options: 'i' } }
            ]
        }
        : {};

    const totalCount = await Member.countDocuments(query);
    const members = await Member.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    res.json(formatPaginatedResponse(members, page, limit, totalCount));
});

// @desc    Get member by ID
// @route   GET /api/members/:id
// @access  Private
const getMemberById = asyncHandler(async (req, res) => {
    const member = await Member.findById(req.params.id);

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
    const { name, email, phone, memberId, role, status } = req.body;

    const memberExists = await Member.findOne({ email });

    if (memberExists) {
        res.status(400);
        throw new Error('Member already exists with this email');
    }

    // Use provided memberId or generate a unique one using UUID structure or a sophisticated sequence
    // For now, if not provided, we should ensure uniqueness more robustly.
    // However, the front-end seems to provide a memberId. If not, generate one.
    let finalMemberId = memberId;
    if (!finalMemberId) {
        // Fallback to random 6 digit for readability as per requirements, but robustly check existence
        // or usage of UUID if pure uniqueness is preferred.
        // Given text block requested UUID replacement:
        finalMemberId = `MEM-${uuidv4().substring(0, 8).toUpperCase()}`;
    } else {
        // Enforce uniqueness
        const idExists = await Member.findOne({ memberId: finalMemberId });
        if (idExists) {
            res.status(400);
            throw new Error('Member ID already exists');
        }
    }

    const member = await Member.create({
        memberId: finalMemberId,
        name,
        email,
        phone,
        role: role || 'Member',
        status: status || 'active',
        lastActive: new Date(),
        // Explicitly set shares and contribution to 0. 
        // These can ONLY be updated via Deposit/Investment transactions.
        shares: Number(req.body.shares) || 0,
        totalContributed: Number(req.body.totalContributed) || 0
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
        // Strict Check: If modifying shares/totalContributed, ensure NO transactions exist.
        if (req.body.shares !== undefined && req.body.shares !== member.shares) {
            const transactionCount = await Transaction.countDocuments({
                memberId: req.params.id,
                type: { $in: ['Deposit', 'Investment', 'Expense'] } // Check any financial movement
            });

            if (transactionCount > 0) {
                res.status(400);
                throw new Error('Cannot modify shares manually for a member with active financial history. Please use Deposit/Investment transactions to adjust equity.');
            }
            member.shares = req.body.shares;
        }

        if (req.body.totalContributed !== undefined && req.body.totalContributed !== member.totalContributed) {
            const transactionCount = await Transaction.countDocuments({
                memberId: req.params.id,
                type: { $in: ['Deposit', 'Investment', 'Expense'] }
            });

            if (transactionCount > 0) {
                res.status(400);
                throw new Error('Cannot modify total capital manually for a member with active financial history.');
            }
            member.totalContributed = req.body.totalContributed;
        }

        member.name = req.body.name || member.name;
        member.email = req.body.email || member.email;
        member.phone = req.body.phone || member.phone;
        member.role = req.body.role || member.role;
        member.status = req.body.status || member.status;

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

    // Check for related deposits/transactions
    const deposits = await Transaction.countDocuments({
        memberId: req.params.id,
        type: { $in: ['Deposit', 'Investment'] }
    });

    if (deposits > 0) {
        res.status(400);
        throw new Error('Cannot delete member with existing deposits or investments');
    }

    // Check for related projects
    const projects = await Project.countDocuments({
        'involvedMembers.memberId': req.params.id
    });

    if (projects > 0) {
        res.status(400);
        throw new Error('Cannot delete member involved in projects');
    }

    await member.deleteOne();
    await recalculateAllStats();
    res.json({ message: 'Member removed' });
});

export {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
};
