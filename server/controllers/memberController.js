import { getDb, getSql } from '../db/connection.js';
import { members, users, transactions, projectMembers, systemSettings } from '../db/schema/index.js';
import { eq, and, or, desc, asc, count, ilike, inArray, not } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import asyncHandler from 'express-async-handler';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { queueStatsRecalculation } from './analyticsController.js';
import cache from '../utils/cache.js';

const getShareValue = async (db) => {
  const [setting] = await db.select().from(systemSettings).limit(1);
  return setting?.shareValueBdt ? Number(setting.shareValueBdt) : 1000;
};

const SUCCESSFUL_DEPOSIT_STATUSES = ['Success', 'Completed'];


const attachSuccessfulDepositTotals = async (membersArray) => {
    if (!membersArray.length) return membersArray;

    const memberIds = membersArray.map(member => member.id);
    const pg = getSql();
    const depositStats = await pg`
      SELECT member_id, SUM(amount) as successful_deposit_total
      FROM transactions
      WHERE type = 'Deposit' AND status = ANY(${SUCCESSFUL_DEPOSIT_STATUSES}) AND member_id = ANY(${memberIds})
      GROUP BY member_id
    `;

    const depositMap = new Map(depositStats.map(stat => [stat.member_id, parseFloat(stat.successful_deposit_total) || 0]));

    return membersArray.map(member => ({
        ...member,
        successfulDepositTotal: depositMap.get(member.id) || 0
    }));
};

// @desc Get all members
// @route GET /api/members
// @access Private
const getMembers = asyncHandler(async (req, res) => {
    const db = getDb();
    const { page, limit, skip, sortOptions } = getPaginationParams(req.query, {
        sortBy: 'name',
        sortOrder: 'asc'
    });
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'name';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    // Build search and filter conditions
    const conditions = [];
    if (search) {
        conditions.push(or(
            ilike(members.name, `%${search}%`),
            ilike(members.email, `%${search}%`),
            ilike(members.memberId, `%${search}%`)
        ));
    }
    if (req.query.status) conditions.push(eq(members.status, req.query.status));
    if (req.query.role) conditions.push(eq(members.role, req.query.role));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let membersList;
    let totalCount;

    if (sortBy === 'successfulDepositTotal') {
        // Use raw SQL with subquery for computing deposit total
        const pg = getSql();

        // Total count first
        const countResult = await db.select({ count: count() }).from(members)
            .where(whereClause || undefined);
        totalCount = Number(countResult[0].count);

        // Build a dynamic query for paginated results sorted by computed deposit total
        let dataQuery = pg`
            SELECT m.id, m.member_id as "memberId", m.name, m.email, m.phone, m.role,
                   m.shares, m.total_contributed as "totalContributed", m.status,
                   m.avatar, m.last_active as "lastActive", m.created_by as "createdBy",
                   m.updated_by as "updatedBy", m.user_id as "userId",
                   m.has_user_access as "hasUserAccess", m.legacy_mongo_id as "legacyMongoId",
                   m.created_at as "createdAt", m.updated_at as "updatedAt",
                   COALESCE((
                       SELECT SUM(t.amount::numeric)
                       FROM transactions t
                       WHERE t.member_id = m.id AND t.type = 'Deposit' AND t.status = ANY(${SUCCESSFUL_DEPOSIT_STATUSES})
                   ), 0) as "successfulDepositTotal"
            FROM members m
            WHERE 1=1
        `;

        if (search) {
            dataQuery = pg`
                ${dataQuery} AND (m.name ILIKE ${'%' + search + '%'} OR m.email ILIKE ${'%' + search + '%'} OR m.member_id ILIKE ${'%' + search + '%'})
            `;
        }
        if (req.query.status) {
            dataQuery = pg`${dataQuery} AND m.status = ${req.query.status}`;
        }
        if (req.query.role) {
            dataQuery = pg`${dataQuery} AND m.role = ${req.query.role}`;
        }

        const orderDir = sortOrder === 'asc' ? pg`ASC` : pg`DESC`;
        dataQuery = pg`${dataQuery} ORDER BY "successfulDepositTotal" ${orderDir}, m.name ASC`;
        dataQuery = pg`${dataQuery} LIMIT ${limit} OFFSET ${skip}`;

        membersList = await dataQuery;
    } else {
        // Regular Drizzle ORM path
        let orderByColumn;
        if (sortBy === 'totalContributed') {
            orderByColumn = members.totalContributed;
        } else if (members[sortBy]) {
            orderByColumn = members[sortBy];
        } else {
            orderByColumn = members.name;
        }

        const orderByClause = sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

        const [countResult, rawMembers] = await Promise.all([
            db.select({ count: count() }).from(members).where(whereClause || undefined),
            db.select().from(members)
                .where(whereClause || undefined)
                .orderBy(orderByClause)
                .offset(skip)
                .limit(limit)
        ]);

        totalCount = Number(countResult[0].count);
        membersList = await attachSuccessfulDepositTotals(rawMembers);
    }

    res.json(formatPaginatedResponse(membersList, page, limit, totalCount));
});

// @desc Get member by ID
// @route GET /api/members/:id
// @access Private
const getMemberById = asyncHandler(async (req, res) => {
    const db = getDb();
    const memberResult = await db.select().from(members)
        .where(eq(members.id, req.params.id))
        .limit(1);

    if (!memberResult.length) {
        res.status(404);
        throw new Error('Member not found');
    }

    const member = memberResult[0];

    // Fetch related user info (replaces Mongoose .populate)
    const [createdByUser, updatedByUser, userInfo] = await Promise.all([
        member.createdBy
            ? db.select({ id: users.id, name: users.name, email: users.email })
                .from(users).where(eq(users.id, member.createdBy)).limit(1)
            : Promise.resolve([]),
        member.updatedBy
            ? db.select({ id: users.id, name: users.name, email: users.email })
                .from(users).where(eq(users.id, member.updatedBy)).limit(1)
            : Promise.resolve([]),
        member.userId
            ? db.select({ id: users.id, name: users.name, email: users.email, lastLogin: users.lastLogin })
                .from(users).where(eq(users.id, member.userId)).limit(1)
            : Promise.resolve([])
    ]);

    res.json({
        ...member,
        createdBy: createdByUser[0] || null,
        updatedBy: updatedByUser[0] || null,
        userId: userInfo[0] || null
    });
});

// @desc Create a member
// @route POST /api/members
// @access Private/Admin
const createMember = asyncHandler(async (req, res) => {
    const db = getDb();
    const { name, email, phone, memberId, role, status, shares } = req.body;

    if (!name || !email || !phone) {
        res.status(400);
        throw new Error('Name, Email and Phone are required');
    }

    const existingMember = await db.select().from(members)
        .where(eq(members.email, email))
        .limit(1);
    if (existingMember.length > 0) {
        res.status(400);
        throw new Error('Member already exists with this email');
    }

    // Role-based ID generation: Ensure uniqueness
    let finalMemberId = memberId;
    if (!finalMemberId) {
        const countResult = await db.select({ count: count() }).from(members);
        const count = Number(countResult[0].count);
        finalMemberId = `MEM-${(count + 1).toString().padStart(4, '0')}`;
    }

    const idExists = await db.select().from(members)
        .where(eq(members.memberId, finalMemberId))
        .limit(1);
    if (idExists.length > 0) {
        // If provided id exists, generate a unique one as fallback or error
        finalMemberId = `MEM-${uuidv4().substring(0, 8).toUpperCase()}`;
    }

    const shareValue = await getShareValue(db);

    const createdMembers = await db.insert(members).values({
        memberId: finalMemberId,
        name,
        email,
        phone,
        role: role || 'Member',
        status: status || 'active',
        lastActive: new Date(),
        // Initial balance allowed only on creation, thereafter must use transactions
        shares: Number(shares) || 0,
        totalContributed: String((Number(shares) || 0) * shareValue),
        createdBy: req.user?.id,
        updatedBy: req.user?.id
    }).returning();

    const member = createdMembers[0];

    if (member) {
        queueStatsRecalculation();
        // Invalidate members list cache
        cache.invalidateByPrefix('members:list');
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
    const db = getDb();
    const existingMember = await db.select().from(members)
        .where(eq(members.id, req.params.id))
        .limit(1);

    if (!existingMember.length) {
        res.status(404);
        throw new Error('Member not found');
    }

    const member = existingMember[0];
    const updateData = {};

    // SHARES CAN ALWAYS BE EDITED FROM MEMBERS SCREEN
    if (req.body.shares !== undefined) {
        updateData.shares = Number(req.body.shares);
    }

    // totalContributed can also be updated
    if (req.body.totalContributed !== undefined) {
        updateData.totalContributed = String(Number(req.body.totalContributed));
    }

    // Standard updates
    updateData.name = req.body.name || member.name;
    updateData.email = req.body.email || member.email;
    updateData.phone = req.body.phone || member.phone;
    updateData.role = req.body.role || member.role;
    updateData.status = req.body.status || member.status;
    updateData.updatedBy = req.user?.id;

    const updatedMembers = await db.update(members)
        .set(updateData)
        .where(eq(members.id, member.id))
        .returning();

    const updatedMember = updatedMembers[0];
    queueStatsRecalculation();
    // Invalidate members list cache
    cache.invalidateByPrefix('members:list');
    res.json(updatedMember);
});

// @desc Delete member
// @route DELETE /api/members/:id
// @access Private/Admin
const deleteMember = asyncHandler(async (req, res) => {
    const db = getDb();
    const memberResult = await db.select().from(members)
        .where(eq(members.id, req.params.id))
        .limit(1);

    if (!memberResult.length) {
        res.status(404);
        throw new Error('Member not found');
    }

    const member = memberResult[0];

    // Enterprise Grade: Check for ANY related data before hard delete
    const transactionResult = await db.select({ count: count() })
        .from(transactions)
        .where(eq(transactions.memberId, req.params.id));
    const transactionCount = Number(transactionResult[0].count);
    if (transactionCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member has ${transactionCount} financial record${transactionCount > 1 ? 's' : ''}. Set the member to inactive instead.`);
    }

    const projectMembersResult = await db.select({ count: count() })
        .from(projectMembers)
        .where(eq(projectMembers.memberId, req.params.id));
    const projectCount = Number(projectMembersResult[0].count);
    if (projectCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member is linked to ${projectCount} project${projectCount > 1 ? 's' : ''}. Remove the member from those projects first.`);
    }

    const linkedUserResult = await db.select()
        .from(users)
        .where(or(
            eq(users.id, member.userId),
            eq(users.memberId, member.memberId)
        ))
        .limit(1);
    if (linkedUserResult.length > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member still has system access. Remove the linked user account first.`);
    }

    await db.delete(members).where(eq(members.id, member.id));
    queueStatsRecalculation();
    // Invalidate members list cache
    cache.invalidateByPrefix('members:list');
    res.json({ message: 'Member successfully removed' });
});

// @desc Onboard a new member with system access in one go
// @route POST /api/members/onboard
// @access Private/Admin
const onboardMember = asyncHandler(async (req, res) => {
    const db = getDb();
    const { name, email, phone, role, status, shares, systemAccess, password, userRole } = req.body;

    // Fetch settings outside of the transaction (read-only)
    const shareValue = await getShareValue(db);

    try {
        const member = await db.transaction(async (tx) => {
            // 1. Create Member
            const countResult = await tx.select({ count: count() }).from(members);
            const count = Number(countResult[0].count);
            const memberId = `MEM-${(count + 1).toString().padStart(4, '0')}`;

            const createdMembers = await tx.insert(members).values({
                memberId,
                name,
                email,
                phone,
                role: role || 'Member',
                status: status || 'active',
                shares: Number(shares) || 0,
                totalContributed: String((Number(shares) || 0) * shareValue),
                createdBy: req.user?.id,
                updatedBy: req.user?.id,
                hasUserAccess: systemAccess || false
            }).returning();

            const createdMember = createdMembers[0];

            // 2. If system access, create User
            if (systemAccess) {
                if (!password || password.length < 6) {
                    throw new Error('Password is required for system access (min 6 chars)');
                }

                const existingUser = await tx.select()
                    .from(users)
                    .where(eq(users.email, email))
                    .limit(1);
                if (existingUser.length > 0) {
                    throw new Error('User account already exists with this email');
                }

                const createdUsers = await tx.insert(users).values({
                    name,
                    email,
                    password,
                    role: userRole || 'Member',
                    memberId: memberId,
                    permissions: {}
                }).returning();

                const user = createdUsers[0];

                // Link user back to member
                await tx.update(members)
                    .set({ userId: user.id })
                    .where(eq(members.id, createdMember.id));
                createdMember.userId = user.id;
            }

            return createdMember;
        });

        queueStatsRecalculation();
        // Invalidate members list cache
        cache.invalidateByPrefix('members:list');

        res.status(201).json(member);
    } catch (error) {
        res.status(error.message.includes('required') || error.message.includes('exists') ? 400 : 500);
        throw error;
    }
});

// @desc Recalculate financial totals for all members based on transaction history
// @route POST /api/members/recalculate-financials
// @access Private/Admin
const recalculateMemberFinancials = asyncHandler(async (req, res) => {
    const db = getDb();
    // FIXED: Now accounts for withdrawals, dividends, and other deductions
    const pg = getSql();

    // 1. Aggregate all deposits by member
    const depositStats = await pg`
      SELECT member_id, SUM(amount) as total_deposited
      FROM transactions WHERE type = 'Deposit' AND status IN ('Success', 'Completed')
      GROUP BY member_id
    `;

    // 2. Aggregate all withdrawals/deductions by member
    const withdrawalStats = await pg`
      SELECT member_id, SUM(amount) as total_withdrawn
      FROM transactions WHERE type IN ('Withdrawal', 'Dividend') AND status IN ('Success', 'Completed')
      GROUP BY member_id
    `;

    // 3. Create maps for quick lookup
    const depositMap = new Map(depositStats.map(s => [s.member_id, parseFloat(s.total_deposited) || 0]));
    const withdrawalMap = new Map(withdrawalStats.map(s => [s.member_id, parseFloat(s.total_withdrawn) || 0]));

    // 4. Get all members who have any transactions
    const allMemberIds = [...new Set([
        ...depositStats.map(s => s.member_id),
        ...withdrawalStats.map(s => s.member_id)
    ])];

    // 5. Prepare update data
    const updates = allMemberIds.map(memberId => {
        const totalDeposited = depositMap.get(memberId) || 0;
        const totalWithdrawn = withdrawalMap.get(memberId) || 0;
        const netContributed = Math.max(0, totalDeposited - totalWithdrawn);
        return { memberId, netContributed: String(netContributed) };
    });

    // 6. Execute updates in a transaction
    await db.transaction(async (tx) => {
        // Process in chunks to keep transactions manageable
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
            const chunk = updates.slice(i, i + CHUNK_SIZE);
            for (const { memberId, netContributed } of chunk) {
                await tx.update(members)
                    .set({ totalContributed: netContributed })
                    .where(eq(members.id, memberId));
            }
        }

        // 7. Handle members with NO transactions (reset to 0)
        if (allMemberIds.length > 0) {
            await tx.update(members)
                .set({ totalContributed: '0' })
                .where(not(inArray(members.id, allMemberIds)));
        } else {
            // No members have any transactions, reset ALL members
            await tx.update(members)
                .set({ totalContributed: '0' });
        }
    });

    queueStatsRecalculation(); // Update global stats too

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
