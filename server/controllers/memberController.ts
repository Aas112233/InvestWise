import { eq, and, or, desc, asc, count, ilike, inArray, sql, not } from 'drizzle-orm';
import asyncHandler from 'express-async-handler';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/connection.js';
import { members, users, transactions, systemSettings, projectMembers } from '../db/schema/index.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { queueStatsRecalculation } from './analyticsController.js';
import cache from '../utils/cache.js';

const SUCCESSFUL_DEPOSIT_STATUSES = ['Success', 'Completed'];

const attachSuccessfulDepositTotals = async (membersList: any[]) => {
    if (!membersList.length) return membersList;

    const db = getDb();
    const memberIds = membersList.map(m => m.id);
    const result = await db.execute(sql`
      SELECT member_id, COALESCE(SUM(amount::numeric), 0) as successful_deposit_total
      FROM transactions
      WHERE type = 'Deposit' AND status = ANY(${SUCCESSFUL_DEPOSIT_STATUSES}) AND member_id = ANY(${memberIds})
      GROUP BY member_id
    `);

    const depositMap = new Map(
        (result as any[]).map((row: any) => [row.member_id, Number(row.successful_deposit_total)])
    );

    return membersList.map(member => ({
        ...member,
        successfulDepositTotal: depositMap.get(member.id) || 0
    }));
};

// @desc Get all members
// @route GET /api/members
// @access Private
const getMembers = asyncHandler(async (req: any, res: any) => {
    const { page, limit, skip, sortBy: paginationSortBy, sortOrder: paginationSortOrder } = getPaginationParams(req.query, {
        sortBy: 'name',
        sortOrder: 'asc'
    });
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || paginationSortBy;
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const db = getDb();

    // Build search/filter conditions
    const conditions: any[] = [];
    if (search) {
        conditions.push(
            or(
                ilike(members.name, `%${search}%`),
                ilike(members.email, `%${search}%`),
                ilike(members.memberId, `%${search}%`)
            )
        );
    }
    if (req.query.status) {
        conditions.push(eq(members.status, req.query.status));
    }
    if (req.query.role) {
        conditions.push(eq(members.role, req.query.role));
    }

    const whereConditions = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db.select({ total: count() }).from(members).where(whereConditions);
    const totalCount = Number(countResult.total);

    let membersList: any[];

    if (sortBy === 'successfulDepositTotal') {
        // Raw SQL for sorting by computed column
        const searchClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;

        const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

        const rows = await db.execute(sql`
          SELECT
            m.id,
            m.member_id as "memberId",
            m.name,
            m.email,
            m.phone,
            m.role,
            m.shares,
            m.total_contributed as "totalContributed",
            m.status,
            m.avatar,
            m.last_active as "lastActive",
            m.created_by as "createdBy",
            m.updated_by as "updatedBy",
            m.user_id as "userId",
            m.has_user_access as "hasUserAccess",
            m.legacy_mongo_id as "legacyMongoId",
            m.created_at as "createdAt",
            m.updated_at as "updatedAt",
            COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.type = 'Deposit' AND t.status = ANY(${SUCCESSFUL_DEPOSIT_STATUSES})), 0) as "successfulDepositTotal"
          FROM members m
          LEFT JOIN transactions t ON t.member_id = m.id
          ${searchClause}
          GROUP BY m.id
          ORDER BY "successfulDepositTotal" ${sql.raw(orderDir)}
          OFFSET ${skip}
          LIMIT ${limit}
        `);

        membersList = rows as any[];
    } else {
        // Build orderBy expression from the provided sort field
        const columnMap: Record<string, any> = {
            name: members.name,
            email: members.email,
            memberId: members.memberId,
            status: members.status,
            role: members.role,
            shares: members.shares,
            totalContributed: members.totalContributed,
            createdAt: members.createdAt,
            updatedAt: members.updatedAt,
        };
        const col = columnMap[sortBy] || members.name;
        const orderByExp = sortOrder === 'asc' ? asc(col) : desc(col);

        const rawMembers = await db.select()
            .from(members)
            .where(whereConditions)
            .orderBy(orderByExp)
            .offset(skip)
            .limit(limit);

        membersList = await attachSuccessfulDepositTotals(rawMembers);
    }

    res.json(formatPaginatedResponse(membersList, page, limit, totalCount));
});

// @desc Get member by ID
// @route GET /api/members/:id
// @access Private
const getMemberById = asyncHandler(async (req: any, res: any) => {
    const db = getDb();
    const [member] = await db.select().from(members).where(eq(members.id, req.params.id)).limit(1);

    if (member) {
        const result: any = { ...member };

        // Populate createdBy user
        if (member.createdBy) {
            const [createdByUser] = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
            }).from(users).where(eq(users.id, member.createdBy)).limit(1);
            result.createdBy = createdByUser || member.createdBy;
        }

        // Populate updatedBy user
        if (member.updatedBy) {
            const [updatedByUser] = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
            }).from(users).where(eq(users.id, member.updatedBy)).limit(1);
            result.updatedBy = updatedByUser || member.updatedBy;
        }

        // Populate userId user
        if (member.userId) {
            const [userIdUser] = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                lastLogin: users.lastLogin,
            }).from(users).where(eq(users.id, member.userId)).limit(1);
            result.userId = userIdUser || member.userId;
        }

        res.json(result);
    } else {
        res.status(404);
        throw new Error('Member not found');
    }
});

// @desc Create a member
// @route POST /api/members
// @access Private/Admin
const createMember = asyncHandler(async (req: any, res: any) => {
    const { name, email, phone, memberId, role, status, shares } = req.body;

    if (!name || !email || !phone) {
        res.status(400);
        throw new Error('Name, Email and Phone are required');
    }

    const db = getDb();

    const [memberExists] = await db.select().from(members).where(eq(members.email, email)).limit(1);
    if (memberExists) {
        res.status(400);
        throw new Error('Member already exists with this email');
    }

    // Role-based ID generation: Ensure uniqueness
    let finalMemberId = memberId;
    if (!finalMemberId) {
        const [countResult] = await db.select({ total: count() }).from(members);
        const memberCount = Number(countResult.total);
        finalMemberId = `MEM-${(memberCount + 1).toString().padStart(4, '0')}`;
    }

    const [idExists] = await db.select().from(members).where(eq(members.memberId, finalMemberId)).limit(1);
    if (idExists) {
        // If provided id exists, generate a unique one as fallback
        finalMemberId = `MEM-${uuidv4().substring(0, 8).toUpperCase()}`;
    }

    const [settings] = await db.select().from(systemSettings).limit(1);
    const shareValue = settings?.shareValueBdt ? Number(settings.shareValueBdt) : 1000;

    const [member] = await db.insert(members).values({
        memberId: finalMemberId,
        name,
        email,
        phone,
        role: role || 'Member',
        status: status || 'active',
        lastActive: new Date(),
        shares: Number(shares) || 0,
        totalContributed: String((Number(shares) || 0) * shareValue),
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
    }).returning();

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
const updateMember = asyncHandler(async (req: any, res: any) => {
    const db = getDb();
    const [member] = await db.select().from(members).where(eq(members.id, req.params.id)).limit(1);

    if (member) {
        const updateData: Record<string, any> = {};

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
        updateData.updatedAt = new Date();

        const [updatedMember] = await db.update(members)
            .set(updateData)
            .where(eq(members.id, member.id))
            .returning();

        queueStatsRecalculation();
        // Invalidate members list cache
        cache.invalidateByPrefix('members:list');
        res.json(updatedMember);
    } else {
        res.status(404);
        throw new Error('Member not found');
    }
});

// @desc Delete member
// @route DELETE /api/members/:id
// @access Private/Admin
const deleteMember = asyncHandler(async (req: any, res: any) => {
    const db = getDb();
    const [member] = await db.select().from(members).where(eq(members.id, req.params.id)).limit(1);

    if (!member) {
        res.status(404);
        throw new Error('Member not found');
    }

    // Enterprise Grade: Check for ANY related data before hard delete
    const [txCountResult] = await db.select({ total: count() }).from(transactions)
        .where(eq(transactions.memberId, req.params.id));
    const transactionCount = Number(txCountResult.total);

    if (transactionCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member has ${transactionCount} financial record${transactionCount > 1 ? 's' : ''}. Set the member to inactive instead.`);
    }

    const [projCountResult] = await db.select({ total: count() }).from(projectMembers)
        .where(eq(projectMembers.memberId, req.params.id));
    const projectCount = Number(projCountResult.total);

    if (projectCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete ${member.name}. This member is linked to ${projectCount} project${projectCount > 1 ? 's' : ''}. Remove the member from those projects first.`);
    }

    // Check for linked user account
    const userConditions: any[] = [];
    if (member.userId) {
        userConditions.push(eq(users.id, member.userId));
    }
    userConditions.push(eq(users.memberId, member.memberId));

    const [linkedUser] = await db.select().from(users).where(or(...userConditions)).limit(1);

    if (linkedUser) {
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
const onboardMember = asyncHandler(async (req: any, res: any) => {
    const { name, email, phone, role, status, shares, systemAccess, password, userRole } = req.body;
    const db = getDb();

    let member: any;

    try {
        member = await db.transaction(async (tx) => {
            const [settings] = await tx.select().from(systemSettings).limit(1);
            const shareValue = settings?.shareValueBdt ? Number(settings.shareValueBdt) : 1000;

            // 1. Count existing members for ID generation
            const [countResult] = await tx.select({ total: count() }).from(members);
            const memberCount = Number(countResult.total);
            const memberId = `MEM-${(memberCount + 1).toString().padStart(4, '0')}`;

            // 2. Create Member
            const [newMember] = await tx.insert(members).values({
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
                hasUserAccess: systemAccess,
            }).returning();

            // 3. If system access, create User
            if (systemAccess) {
                if (!password || password.length < 6) {
                    throw new Error('Password is required for system access (min 6 chars)');
                }

                const [existingUser] = await tx.select().from(users)
                    .where(eq(users.email, email)).limit(1);

                if (existingUser) {
                    throw new Error('User account already exists with this email');
                }

                const [user] = await tx.insert(users).values({
                    name,
                    email,
                    phone,
                    password,
                    role: userRole || 'Member',
                    memberId: memberId,
                }).returning();

                // Link user back to member
                await tx.update(members)
                    .set({ userId: user.id })
                    .where(eq(members.id, newMember.id));

                return { ...newMember, userId: user.id };
            }

            return newMember;
        });
    } catch (error: any) {
        res.status(
            error.message.includes('required') || error.message.includes('exists') ? 400 : 500
        );
        throw error;
    }

    queueStatsRecalculation();
    // Invalidate members list cache
    cache.invalidateByPrefix('members:list');

    res.status(201).json(member);
});

// @desc Recalculate financial totals for all members based on transaction history
// @route POST /api/members/recalculate-financials
// @access Private/Admin
const recalculateMemberFinancials = asyncHandler(async (req: any, res: any) => {
    const db = getDb();

    // 1. Aggregate all deposits by member
    const depositStats = await db.execute(sql`
      SELECT member_id, COALESCE(SUM(amount::numeric), 0) as total_deposited
      FROM transactions
      WHERE type = 'Deposit' AND status IN ('Success', 'Completed')
      GROUP BY member_id
    `);

    // 2. Aggregate all withdrawals/deductions by member
    const withdrawalStats = await db.execute(sql`
      SELECT member_id, COALESCE(SUM(amount::numeric), 0) as total_withdrawn
      FROM transactions
      WHERE type IN ('Withdrawal', 'Dividend') AND status IN ('Success', 'Completed')
      GROUP BY member_id
    `);

    // 3. Create maps for quick lookup
    const depositMap = new Map(
        (depositStats as any[]).map((row: any) => [row.member_id, Number(row.total_deposited)])
    );
    const withdrawalMap = new Map(
        (withdrawalStats as any[]).map((row: any) => [row.member_id, Number(row.total_withdrawn)])
    );

    // 4. Get all member IDs who have any transactions
    const allMemberIds = [...new Set([
        ...Array.from(depositMap.keys()),
        ...Array.from(withdrawalMap.keys()),
    ])];

    // 5. Execute updates
    if (allMemberIds.length > 0) {
        // Process in chunks to avoid overwhelming the database
        const CHUNK_SIZE = 1000;

        await db.transaction(async (tx) => {
            for (const memberId of allMemberIds) {
                const totalDeposited = depositMap.get(memberId) || 0;
                const totalWithdrawn = withdrawalMap.get(memberId) || 0;
                const netContributed = Math.max(0, totalDeposited - totalWithdrawn);

                await tx.update(members)
                    .set({ totalContributed: String(netContributed) })
                    .where(eq(members.id, memberId));
            }

            // Handle members with NO transactions (reset to 0)
            await tx.update(members)
                .set({ totalContributed: '0' })
                .where(not(inArray(members.id, allMemberIds)));
        });
    } else {
        // No transaction records exist at all; reset all members to 0
        await db.update(members).set({ totalContributed: '0' });
    }

    queueStatsRecalculation(); // Update global stats too

    res.json({
        message: 'Financials recalculated successfully',
        membersUpdated: allMemberIds.length,
        details: {
            membersWithDeposits: (depositStats as any[]).length,
            membersWithWithdrawals: (withdrawalStats as any[]).length,
        },
    });
});

export {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
    onboardMember,
    recalculateMemberFinancials,
};
