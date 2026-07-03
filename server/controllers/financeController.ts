import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { transactions, funds, members, projects, projectUpdates, projectMembers, auditLogs, deletedRecords } from '../db/schema/index.js';
import { eq, and, or, desc, asc, count, ilike, inArray, sql, gte, lte, not } from 'drizzle-orm';
import { logAudit } from '../utils/auditLogger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/paginationHelper.js';
import { queueStatsRecalculation } from './analyticsController.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEPOSIT_MONTH_INDEX: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
    'জানুয়ারি': 0,
    'ফেব্রুয়ারি': 1,
    'মার্চ': 2,
    'এপ্রিল': 3,
    'মে': 4,
    'জুন': 5,
    'জুলাই': 6,
    'আগস্ট': 7,
    'সেপ্টেম্বর': 8,
    'অক্টোবর': 9,
    'নভেম্বর': 10,
    'ডিসেম্বর': 11
};

const normalizeBanglaDigits = (value = '') =>
    value.replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildFlexibleMemberIdRegex = (value = '') => {
    const compactValue = value.replace(/[\s\-_]+/g, '').trim();
    if (!compactValue) return null;

    return compactValue
        .split('')
        .map((char) => escapeRegex(char))
        .join('[-_\\s]*');
};

const parseDepositMonthLabel = (depositMonth: string) => {
    if (!depositMonth || typeof depositMonth !== 'string') return null;

    const normalizedLabel = normalizeBanglaDigits(depositMonth.trim());
    const parts = normalizedLabel.split(/\s+/);
    if (parts.length < 2) return null;

    const year = Number(parts[parts.length - 1]);
    const monthLabel = parts.slice(0, -1).join(' ').toLowerCase();
    const monthIndex = DEPOSIT_MONTH_INDEX[monthLabel];

    if (monthIndex === undefined || Number.isNaN(year)) {
        return null;
    }

    return new Date(Date.UTC(year, monthIndex, 1));
};

const resolveDepositDate = ({ date, depositMonth }: { date?: string; depositMonth?: string }) => {
    const monthDate = parseDepositMonthLabel(depositMonth || '');
    const parsedDate = date ? new Date(date) : null;
    const hasValidDate = parsedDate instanceof Date && !Number.isNaN(parsedDate.getTime());

    if (monthDate && hasValidDate) {
        const sameMonth =
            parsedDate.getUTCFullYear() === monthDate.getUTCFullYear() &&
            parsedDate.getUTCMonth() === monthDate.getUTCMonth();

        return sameMonth ? parsedDate : monthDate;
    }

    if (monthDate) return monthDate;
    if (hasValidDate) return parsedDate;

    return new Date();
};

// @desc    Get all transactions
// @route   GET /api/finance/transactions
// @access  Private
const getTransactions = asyncHandler(async (req: any, res: any) => {
    const { page, limit, skip, sortBy: paginationSortBy, sortOrder: paginationSortOrder } = getPaginationParams(req.query, {
        sortBy: 'date',
        sortOrder: 'desc'
    });
    const search = String(req.query.search || '').trim();
    const searchField = req.query.searchField || 'all';
    const sortBy = req.query.sortBy || paginationSortBy;
    const sortOrder: 'asc' | 'desc' = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const db = getDb();

    const conditions: any[] = [];

    // Create search filter
    if (search) {
        if (searchField === 'amount') {
            const num = Number(search);
            if (!isNaN(num)) conditions.push(eq(transactions.amount, String(num)));
        } else if (searchField === 'id') {
            if (UUID_REGEX.test(search)) {
                conditions.push(eq(transactions.id, search));
            } else {
                conditions.push(ilike(transactions.referenceNumber, `%${search}%`));
            }
        } else if (searchField === 'memberId') {
            const flexibleMemberIdRegex = buildFlexibleMemberIdRegex(search);
            const memberConditions: any[] = [
                ilike(members.memberId, `%${search}%`),
            ];
            if (flexibleMemberIdRegex) {
                memberConditions.push(sql`${members.memberId} ~* ${flexibleMemberIdRegex}`);
            }
            const matchingMembers = await db.select({ id: members.id })
                .from(members)
                .where(or(...memberConditions));
            if (matchingMembers.length > 0) {
                conditions.push(inArray(transactions.memberId, matchingMembers.map(m => m.id)));
            } else {
                // Force no results
                conditions.push(sql`1=0`);
            }
        } else if (searchField === 'memberName') {
            const matchingMembers = await db.select({ id: members.id })
                .from(members)
                .where(ilike(members.name, `%${search}%`));
            if (matchingMembers.length > 0) {
                conditions.push(inArray(transactions.memberId, matchingMembers.map(m => m.id)));
            } else {
                conditions.push(sql`1=0`);
            }
        } else if (searchField === 'fundName') {
            const matchingFunds = await db.select({ id: funds.id })
                .from(funds)
                .where(ilike(funds.name, `%${search}%`));
            if (matchingFunds.length > 0) {
                conditions.push(inArray(transactions.fundId, matchingFunds.map(f => f.id)));
            } else {
                conditions.push(sql`1=0`);
            }
        } else {
            // 'all' - optimized parallel search
            const flexibleMemberIdRegex = buildFlexibleMemberIdRegex(search);
            const [memberMatches, fundMatches] = await Promise.all([
                db.select({ id: members.id })
                    .from(members)
                    .where(or(
                        ilike(members.name, `%${search}%`),
                        ilike(members.memberId, `%${search}%`),
                        ...(flexibleMemberIdRegex ? [sql`${members.memberId} ~* ${flexibleMemberIdRegex}`] : [])
                    )),
                db.select({ id: funds.id })
                    .from(funds)
                    .where(ilike(funds.name, `%${search}%`))
            ]);

            const orConditions: any[] = [
                ilike(transactions.type, `%${search}%`),
                ilike(transactions.description, `%${search}%`),
                ilike(transactions.status, `%${search}%`),
                ilike(transactions.referenceNumber, `%${search}%`)
            ];

            if (memberMatches.length > 0) {
                orConditions.push(inArray(transactions.memberId, memberMatches.map(m => m.id)));
            }
            if (fundMatches.length > 0) {
                orConditions.push(inArray(transactions.fundId, fundMatches.map(f => f.id)));
            }
            if (!isNaN(Number(search))) {
                orConditions.push(eq(transactions.amount, String(Number(search))));
            }
            if (UUID_REGEX.test(search)) {
                orConditions.push(eq(transactions.id, search));
            }

            conditions.push(or(...orConditions));
        }
    }

    // Allow filtering by type
    if (req.query.type) conditions.push(eq(transactions.type, req.query.type));

    // Additional: Month/Year filtering
    if (req.query.month && req.query.year) {
        const month = parseInt(req.query.month);
        const year = parseInt(req.query.year);
        if (!isNaN(month) && !isNaN(year)) {
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59);
            conditions.push(and(gte(transactions.date, startDate), lte(transactions.date, endDate)));
        }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sortFieldMap: Record<string, any> = {
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
        status: transactions.status,
        description: transactions.description,
        referenceNumber: transactions.referenceNumber,
        category: transactions.category,
        handlingOfficer: transactions.handlingOfficer,
        depositMethod: transactions.depositMethod,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
    };
    const sortColumn = sortFieldMap[sortBy] || transactions.date;
    const orderBy = sortOrder === 'asc' ? [asc(sortColumn)] : [desc(sortColumn)];

    const [totalResult] = await db.select({ count: count() })
        .from(transactions)
        .where(whereClause);
    const totalCount = totalResult.count;

    const transactionsData = await db
        .select({
            id: transactions.id,
            type: transactions.type,
            amount: transactions.amount,
            description: transactions.description,
            category: transactions.category,
            referenceNumber: transactions.referenceNumber,
            date: transactions.date,
            status: transactions.status,
            memberId: transactions.memberId,
            projectId: transactions.projectId,
            fundId: transactions.fundId,
            handlingOfficer: transactions.handlingOfficer,
            depositMethod: transactions.depositMethod,
            balanceBefore: transactions.balanceBefore,
            balanceAfter: transactions.balanceAfter,
            isDeleted: transactions.isDeleted,
            memberDisplayId: members.memberId,
            memberName: members.name,
            memberEmail: members.email,
            fundName: funds.name,
            projectName: projects.title,
            createdAt: transactions.createdAt,
            updatedAt: transactions.updatedAt,
        })
        .from(transactions)
        .leftJoin(members, eq(transactions.memberId, members.id))
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .leftJoin(projects, eq(transactions.projectId, projects.id))
        .where(whereClause)
        .orderBy(...orderBy)
        .offset(skip)
        .limit(limit);

    const formattedTransactions = transactionsData.map((t: any) => ({
        ...t,
        amount: Number(t.amount) || 0,
        balanceBefore: t.balanceBefore ? Number(t.balanceBefore) : null,
        balanceAfter: t.balanceAfter ? Number(t.balanceAfter) : null,
        memberDisplayId: t.memberDisplayId || 'N/A',
        memberName: t.memberName || 'Unknown',
        fundName: t.fundName || 'N/A',
        projectName: t.projectName || ''
    }));

    // Calculate totals for inflow and outflow (agnostic of pagination)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Rebuild where conditions for totals — same search/type/month filter but always
    // restrict to Completed/Success status and non-deleted
    const totalsConditions: any[] = [];
    if (conditions.length > 0) {
        // Copy all non-status conditions. Since we never added status above,
        // conditions are safe to reuse.
        totalsConditions.push(...conditions);
    }
    totalsConditions.push(inArray(transactions.status, ['Success', 'Completed', 'Processing']));
    totalsConditions.push(eq(transactions.isDeleted, false));
    const totalsWhere = and(...totalsConditions);

    const [totalsRow] = await db
      .select({
        totalInflow: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0)`,
        totalOutflow: sql`COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend') THEN amount::numeric ELSE 0 END), 0)`,
        totalMonthly: sql`COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') AND date >= ${startOfMonth} THEN amount::numeric ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(totalsWhere);

    const stats = {
        totalInflow: Number(totalsRow?.totalInflow || 0),
        totalOutflow: Number(totalsRow?.totalOutflow || 0),
        totalMonthly: Number(totalsRow?.totalMonthly || 0)
    };

    res.json({
        ...formatPaginatedResponse(formattedTransactions, page, limit, Number(totalCount)),
        totalInflow: stats.totalInflow,
        totalOutflow: stats.totalOutflow,
        totalMonthly: stats.totalMonthly
    });
});

// @desc    Add a deposit
// @route   POST /api/finance/deposits
// @access  Private (Admin/Manager)
const addDeposit = asyncHandler(async (req: any, res: any) => {
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

    if (!UUID_REGEX.test(memberId)) {
        res.status(400);
        throw new Error(`Invalid member ID: ${memberId}`);
    }

    if (!fundId) {
        res.status(400);
        throw new Error('Fund ID is required');
    }

    if (!UUID_REGEX.test(fundId)) {
        res.status(400);
        throw new Error(`Invalid fund ID: ${fundId}`);
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
        const [member] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
        if (!fund || !member) throw new Error('Fund or Member not found');

        const balanceBefore = Number(fund.balance);
        const depositDate = resolveDepositDate({ date, depositMonth: description });
        const isCompleted = status === 'Success' || status === 'Completed';

        // 1. Create Transaction Record
        const [txn] = await tx.insert(transactions).values({
            type: 'Deposit',
            amount: String(Number(amount)),
            description: description || '',
            memberId,
            fundId,
            date: depositDate,
            status: status || 'Completed',
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name || cashierName || handlingOfficer || 'System',
            depositMethod: depositMethod || 'Cash',
            referenceNumber: req.body.referenceNumber,
            balanceBefore: String(balanceBefore),
            balanceAfter: isCompleted ? String(balanceBefore + Number(amount)) : String(balanceBefore)
        }).returning();

        // Apply financial impact if Success/Completed
        if (isCompleted) {
            // Update Fund
            const newFundBalance = Number(fund.balance) + Number(amount);
            await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fundId));

            // Update Member - ONLY totalContributed, NEVER shares
            const newTotalContributed = Number(member.totalContributed || 0) + Number(amount);
            await tx.update(members).set({ totalContributed: String(newTotalContributed) }).where(eq(members.id, memberId));
        }

        return txn;
    });

    queueStatsRecalculation();
    res.status(201).json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Edit a deposit
// @route   PUT /api/finance/deposits/:id
// @access  Private (Admin)
const editDeposit = asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    const { memberId, amount, fundId, description, date, shareNumber, cashierName, depositMethod } = req.body;

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.type !== 'Deposit') {
            throw new Error('Transaction is not a deposit');
        }

        const oldAmount = Number(transaction.amount);
        const oldFundId = transaction.fundId;
        const oldMemberId = transaction.memberId;
        const oldStatus = transaction.status;
        const isCompleted = oldStatus === 'Completed';

        const newStatus = req.body.status || oldStatus;
        const isNowCompleted = newStatus === 'Completed';

        const nextMemberId = memberId && memberId !== 'N/A' ? memberId : oldMemberId;
        const newAmount = Number(amount);

        // 1. Revert old financial impact if it was previously completed
        if (isCompleted) {
            const [oldFund] = await tx.select().from(funds).where(eq(funds.id, oldFundId)).limit(1);
            if (oldFund) {
                const revertedBalance = Number(oldFund.balance) - oldAmount;
                await tx.update(funds).set({ balance: String(revertedBalance) }).where(eq(funds.id, oldFundId));
            }

            const [oldMember] = await tx.select().from(members).where(eq(members.id, oldMemberId)).limit(1);
            if (oldMember) {
                const revertedContributed = Number(oldMember.totalContributed || 0) - oldAmount;
                await tx.update(members).set({ totalContributed: String(revertedContributed) }).where(eq(members.id, oldMemberId));
            }
        }

        // 2. Apply new financial impact if it is now completed
        if (isNowCompleted) {
            const [newFund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
            if (!newFund) throw new Error(`Target fund not found: ${fundId}`);

            const newFundBalance = Number(newFund.balance) + newAmount;
            await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fundId));

            const [newMember] = await tx.select().from(members).where(eq(members.id, nextMemberId)).limit(1);
            if (!newMember) throw new Error(`Target partner not found: ${nextMemberId}`);

            const newTotalContributed = Number(newMember.totalContributed || 0) + newAmount;
            await tx.update(members).set({ totalContributed: String(newTotalContributed) }).where(eq(members.id, nextMemberId));
        }

        // 3. Always update transaction record
        const depositDate = resolveDepositDate({ date, depositMonth: description || transaction.description });

        const [updatedTransaction] = await tx.update(transactions).set({
            amount: String(newAmount),
            fundId: fundId,
            memberId: nextMemberId,
            description: description || transaction.description,
            date: depositDate,
            handlingOfficer: req.user.name,
            depositMethod: depositMethod || transaction.depositMethod,
            referenceNumber: req.body.referenceNumber,
            status: newStatus,
            updatedBy: req.user.id,
            updatedAt: new Date()
        }).where(eq(transactions.id, id)).returning();

        // 4. Always create audit log
        await tx.insert(auditLogs).values({
            user: req.user.id,
            userName: req.user.name,
            action: 'EDIT_DEPOSIT',
            resourceType: 'Transaction',
            resourceId: id,
            details: {
                message: `Edited deposit #${id}`,
                previous: { amount: oldAmount, fundId: oldFundId, memberId: oldMemberId, status: oldStatus },
                current: { amount: newAmount, fundId, memberId: nextMemberId, status: newStatus }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        });

        return updatedTransaction;
    });

    queueStatsRecalculation();
    res.json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Approve a pending deposit
// @route   PUT /api/finance/deposits/:id/approve
// @access  Private (Admin)
const approveDeposit = asyncHandler(async (req: any, res: any) => {
    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);

        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            throw new Error('Transaction already approved');
        }

        // Apply Financial Impact
        const [fund] = await tx.select().from(funds).where(eq(funds.id, transaction.fundId)).limit(1);
        const [member] = await tx.select().from(members).where(eq(members.id, transaction.memberId)).limit(1);

        if (!fund) throw new Error('Target Fund not found');
        if (!member) throw new Error('Member not found');

        const txnAmount = Number(transaction.amount);

        // Update Fund
        await tx.update(funds).set({
            balance: String(Number(fund.balance) + txnAmount)
        }).where(eq(funds.id, transaction.fundId));

        // Update Member
        await tx.update(members).set({
            totalContributed: String(Number(member.totalContributed || 0) + txnAmount)
        }).where(eq(members.id, transaction.memberId));

        // Update Transaction
        const [updatedTransaction] = await tx.update(transactions).set({
            status: 'Completed',
            authorizedBy: req.user.id,
            updatedBy: req.user.id,
            updatedAt: new Date()
        }).where(eq(transactions.id, req.params.id)).returning();

        return updatedTransaction;
    });

    queueStatsRecalculation();
    res.json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Add an expense
// @route   POST /api/finance/expenses
// @access  Private (Admin)
const addExpense = asyncHandler(async (req: any, res: any) => {
    let { amount, fundId, description, reason, category, date, projectId, memberId } = req.body;

    // Normalize description
    if (!description && reason) description = reason;
    if (!description) description = '';

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
        if (!fund) throw new Error('Source Fund not found');

        // Capture snapshot before impact
        let balanceBefore = Number(fund.balance);
        let projectRef: any = null;

        if (projectId) {
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw new Error('Project not found');
            if (project.linkedFundId && project.linkedFundId !== fundId) {
                throw new Error('Transactions for this project must be routed through its dedicated project fund.');
            }
            balanceBefore = Number(project.currentFundBalance);
            projectRef = project;
        }

        // Prevent using project funds for non-project expenses
        if (!projectId && fund.type === 'PROJECT') {
            throw new Error('Project-specific funds cannot be used for general expenses. Please select a project first.');
        }

        if (Number(fund.balance) < Number(amount)) {
            throw new Error('Insufficient balance in ' + fund.name);
        }

        const expenseAmount = Number(amount);

        // Apply Project Impact
        if (projectId && projectRef) {
            const projBalanceBefore = Number(projectRef.currentFundBalance);
            const newProjectBalance = projBalanceBefore - expenseAmount;
            const newTotalExpenses = Number(projectRef.totalExpenses || 0) + expenseAmount;

            await tx.update(projects).set({
                currentFundBalance: String(newProjectBalance),
                totalExpenses: String(newTotalExpenses),
                updatedAt: new Date()
            }).where(eq(projects.id, projectId));

            // Record project update in separate table
            await tx.insert(projectUpdates).values({
                projectId,
                type: 'Expense',
                amount: String(expenseAmount),
                description: description,
                date: date ? new Date(date) : new Date(),
                balanceBefore: String(projBalanceBefore),
                balanceAfter: String(newProjectBalance)
            });

            if (description && typeof description === 'string' && !description.includes(`[${projectRef.title}]`)) {
                description = `[${projectRef.title}] ${description}`;
            }
        }

        // Update Fund
        const newFundBalance = Number(fund.balance) - expenseAmount;
        await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fundId));

        // Get the updated project balance if projectId is set
        const balanceAfter = projectId
            ? (await tx.select({ bal: projects.currentFundBalance }).from(projects).where(eq(projects.id, projectId)).limit(1))[0]?.bal
            : String(newFundBalance);

        // Create Transaction
        const [txn] = await tx.insert(transactions).values({
            type: 'Expense',
            amount: String(expenseAmount),
            description: description,
            category: category || 'Operational',
            fundId,
            projectId: projectId || null,
            memberId: memberId || null,
            date: date ? new Date(date) : new Date(),
            status: 'Success',
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name,
            balanceBefore: String(balanceBefore),
            balanceAfter: String(Number(balanceAfter))
        }).returning();

        return txn;
    });

    queueStatsRecalculation();
    res.status(201).json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Edit an expense
// @route   PUT /api/finance/expenses/:id
// @access  Private (Admin/Manager)
const editExpense = asyncHandler(async (req: any, res: any) => {
    const { id } = req.params;
    let { amount, fundId, description, reason, category, date, projectId, memberId } = req.body;

    // Normalize description
    if (!description && reason) description = reason;
    if (!description) description = '';

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.type !== 'Expense') {
            throw new Error('Transaction is not an expense');
        }

        const oldAmount = Number(transaction.amount);
        const oldFundId = transaction.fundId;
        const oldProjectId = transaction.projectId;
        const newAmount = Number(amount);

        // 1. Revert Old Impact
        if (oldProjectId) {
            const [oldProject] = await tx.select().from(projects).where(eq(projects.id, oldProjectId)).limit(1);
            if (oldProject) {
                const revertedBalance = Number(oldProject.currentFundBalance) + oldAmount;
                const revertedExpenses = Math.max(0, Number(oldProject.totalExpenses || 0) - oldAmount);
                await tx.update(projects).set({
                    currentFundBalance: String(revertedBalance),
                    totalExpenses: String(revertedExpenses),
                    updatedAt: new Date()
                }).where(eq(projects.id, oldProjectId));
            }
        }

        const [oldFund] = await tx.select().from(funds).where(eq(funds.id, oldFundId)).limit(1);
        if (oldFund) {
            await tx.update(funds).set({
                balance: String(Number(oldFund.balance) + oldAmount)
            }).where(eq(funds.id, oldFundId));
        }

        // 2. Apply New Impact
        // Enforce Project-Fund Integrity for new data
        if (projectId) {
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw new Error('New project not found');

            if (project.linkedFundId && project.linkedFundId !== fundId) {
                throw new Error('Transactions for this project must be routed through its dedicated project fund.');
            }

            const newProjectBalance = Number(project.currentFundBalance) - newAmount;
            const newTotalExpenses = Number(project.totalExpenses || 0) + newAmount;
            await tx.update(projects).set({
                currentFundBalance: String(newProjectBalance),
                totalExpenses: String(newTotalExpenses),
                updatedAt: new Date()
            }).where(eq(projects.id, projectId));

            // Record project update
            await tx.insert(projectUpdates).values({
                projectId,
                type: 'Expense',
                amount: String(newAmount),
                description: description || transaction.description,
                date: date ? new Date(date) : new Date(),
                balanceBefore: String(Number(project.currentFundBalance) + newAmount),
                balanceAfter: String(newProjectBalance)
            });

            if (description && typeof description === 'string' && !description.includes(`[${project.title}]`)) {
                description = `[${project.title}] ${description}`;
            }
        }

        const [newFund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
        if (!newFund) throw new Error('New source fund not found');

        if (!projectId && newFund.type === 'PROJECT') {
            throw new Error('Project-specific funds cannot be used for general expenses.');
        }

        if (Number(newFund.balance) < newAmount) {
            throw new Error('Insufficient balance in ' + newFund.name);
        }

        await tx.update(funds).set({
            balance: String(Number(newFund.balance) - newAmount)
        }).where(eq(funds.id, fundId));

        // 3. Update Transaction Record
        const [updatedTransaction] = await tx.update(transactions).set({
            amount: String(newAmount),
            fundId: fundId,
            projectId: projectId || null,
            memberId: memberId || null,
            description: description || transaction.description,
            category: category || transaction.category,
            date: date ? new Date(date) : transaction.date,
            updatedBy: req.user.id,
            updatedAt: new Date()
        }).where(eq(transactions.id, id)).returning();

        // 4. Audit Log
        await tx.insert(auditLogs).values({
            user: req.user.id,
            userName: req.user.name,
            action: 'EDIT_EXPENSE',
            resourceType: 'Transaction',
            resourceId: id,
            details: {
                message: `Edited expense #${id}`,
                previous: { amount: oldAmount, fundId: oldFundId, projectId: oldProjectId },
                current: { amount: newAmount, fundId, projectId }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        });

        return updatedTransaction;
    });

    queueStatsRecalculation();
    res.json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Add an earning (General Income / Interest)
// @route   POST /api/finance/earnings
// @access  Private (Admin)
const addEarning = asyncHandler(async (req: any, res: any) => {
    const { amount, fundId, description, category, date, projectId, memberId } = req.body;

    if (!amount || Number(amount) <= 0) {
        res.status(400);
        throw new Error('Invalid earning amount');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
        if (!fund) throw new Error('Target Fund not found');

        let balanceBefore = Number(fund.balance);
        let projectRef: any = null;

        if (projectId) {
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw new Error('Project not found');
            if (project.linkedFundId && project.linkedFundId !== fundId) {
                throw new Error('Transactions for this project must be routed through its dedicated project fund.');
            }
            balanceBefore = Number(project.currentFundBalance);
            projectRef = project;
        }

        const earningAmount = Number(amount);
        let balanceAfter: string;

        // Update Fund
        const newFundBalance = Number(fund.balance) + earningAmount;
        await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fundId));

        if (projectId && projectRef) {
            const projBalanceBefore = Number(projectRef.currentFundBalance);
            const newProjectBalance = projBalanceBefore + earningAmount;
            const newTotalEarnings = Number(projectRef.totalEarnings || 0) + earningAmount;

            await tx.update(projects).set({
                currentFundBalance: String(newProjectBalance),
                totalEarnings: String(newTotalEarnings),
                updatedAt: new Date()
            }).where(eq(projects.id, projectId));

            // Sync with Project Updates
            await tx.insert(projectUpdates).values({
                projectId,
                type: 'Earning',
                amount: String(earningAmount),
                description: description || 'General Earning',
                date: date ? new Date(date) : new Date(),
                balanceBefore: String(projBalanceBefore),
                balanceAfter: String(newProjectBalance)
            });

            balanceAfter = String(newProjectBalance);
        } else {
            balanceAfter = String(newFundBalance);
        }

        // Create Transaction
        const [txn] = await tx.insert(transactions).values({
            type: 'Earning',
            amount: String(earningAmount),
            description: description || 'General Earning',
            category: category || 'Income',
            fundId,
            projectId: projectId || null,
            memberId: memberId || null,
            date: date ? new Date(date) : new Date(),
            status: 'Success',
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name,
            balanceBefore: String(balanceBefore),
            balanceAfter
        }).returning();

        return txn;
    });

    queueStatsRecalculation();
    res.status(201).json({
        ...result,
        amount: Number(result.amount),
        balanceBefore: result.balanceBefore ? Number(result.balanceBefore) : null,
        balanceAfter: result.balanceAfter ? Number(result.balanceAfter) : null
    });
});

// @desc    Delete transaction
// @route   DELETE /api/finance/transactions/:id
// @access  Private (Admin)
const deleteTransaction = asyncHandler(async (req: any, res: any) => {
    const db = getDb();

    const deletedAmount = await db.transaction(async (tx) => {
        const [transaction] = await tx.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);

        if (!transaction) {
            throw new Error('Transaction not found');
        }

        const txnAmount = Number(transaction.amount);
        const txnFundId = transaction.fundId;
        const txnProjectId = transaction.projectId;
        const txnMemberId = transaction.memberId;

        // Only reverse impact if it was actually applied (Success/Completed)
        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            // 1. Revert Fund Balance
            if (txnFundId) {
                const [fund] = await tx.select().from(funds).where(eq(funds.id, txnFundId)).limit(1);
                if (fund) {
                    let adjustedBalance = Number(fund.balance);
                    if (['Deposit', 'Earning', 'Investment'].includes(transaction.type)) {
                        adjustedBalance -= txnAmount;
                    } else if (['Withdrawal', 'Expense', 'Dividend'].includes(transaction.type)) {
                        adjustedBalance += txnAmount;
                    }
                    await tx.update(funds).set({ balance: String(adjustedBalance) }).where(eq(funds.id, txnFundId));
                }
            }

            // 2. Revert Member Contributions (NEVER modify shares here)
            if (txnMemberId && transaction.type === 'Deposit') {
                const [member] = await tx.select().from(members).where(eq(members.id, txnMemberId)).limit(1);
                if (member) {
                    // Recalculate totalContributed from ALL remaining deposits
                    const depositResult = await tx.execute(sql`
                      SELECT COALESCE(SUM(amount::numeric), 0) as total
                      FROM transactions
                      WHERE member_id = ${txnMemberId}
                        AND type = 'Deposit'
                        AND status IN ('Success', 'Completed')
                        AND id != ${req.params.id}
                    `);

                    const totalRemaining = Number(depositResult[0]?.total || 0);
                    await tx.update(members).set({
                        totalContributed: String(totalRemaining)
                    }).where(eq(members.id, txnMemberId));
                }
            }

            // 3. Revert Project Tracking
            if (txnProjectId) {
                const [project] = await tx.select().from(projects).where(eq(projects.id, txnProjectId)).limit(1);
                if (project) {
                    let projectBalanceAdjustment = 0;
                    let projectExpenseAdjustment = 0;
                    let projectEarningAdjustment = 0;

                    if (transaction.type === 'Earning') {
                        projectBalanceAdjustment = -txnAmount;
                        projectEarningAdjustment = -txnAmount;
                    } else if (transaction.type === 'Expense') {
                        projectBalanceAdjustment = txnAmount;
                        projectExpenseAdjustment = -txnAmount;
                    } else if (transaction.type === 'Investment') {
                        projectBalanceAdjustment = -txnAmount;
                    } else if (transaction.type === 'Withdrawal') {
                        projectBalanceAdjustment = txnAmount;
                    }

                    await tx.update(projects).set({
                        currentFundBalance: String(Number(project.currentFundBalance) + projectBalanceAdjustment),
                        totalEarnings: String(Math.max(0, Number(project.totalEarnings || 0) + projectEarningAdjustment)),
                        totalExpenses: String(Math.max(0, Number(project.totalExpenses || 0) + projectExpenseAdjustment)),
                        updatedAt: new Date()
                    }).where(eq(projects.id, txnProjectId));
                }
            }
        }

        // SOFT DELETE: Archive to deleted_records, then mark as deleted
        await tx.insert(deletedRecords).values({
            originalId: req.params.id,
            collectionName: 'Transaction',
            data: transaction,
            deletedBy: req.user.id,
            reason: req.body.reason || 'Manual Deletion',
            deletedAt: new Date()
        });

        // Soft delete in transactions table
        await tx.update(transactions).set({
            isDeleted: true,
            status: 'Deleted',
            deletedAt: new Date(),
            deletedBy: req.user.id,
            deletionReason: req.body.reason || 'Manual Deletion',
            updatedAt: new Date()
        }).where(eq(transactions.id, req.params.id));

        return txnAmount;
    });

    queueStatsRecalculation();

    // Audit Log (after transaction commits)
    await logAudit({
        req,
        user: req.user,
        action: 'DELETE_TRANSACTION',
        resourceType: 'Transaction',
        resourceId: req.params.id,
        details: {
            originalAmount: deletedAmount,
            reason: req.body.reason || 'Manual Deletion'
        }
    });

    res.json({ message: 'Transaction deleted permanently and archived to deleted records' });
});

// @desc    Transfer funds
// @route   POST /api/finance/transfer
// @access  Private (Admin)
const transferFunds = asyncHandler(async (req: any, res: any) => {
    const { sourceFundId, targetFundId, amount, description } = req.body;

    if (!amount || amount <= 0) throw new Error('Transfer amount must be positive');
    if (sourceFundId === targetFundId) throw new Error('Source and Target funds must be different');

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [sourceFund] = await tx.select().from(funds).where(eq(funds.id, sourceFundId)).limit(1);
        const [targetFund] = await tx.select().from(funds).where(eq(funds.id, targetFundId)).limit(1);

        if (!sourceFund || !targetFund) {
            throw new Error('One or both funds not found');
        }

        const transferAmount = Number(amount);

        if (Number(sourceFund.balance) < transferAmount) {
            throw new Error(`Insufficient funds in ${sourceFund.name}. Gap: ${transferAmount - Number(sourceFund.balance)}`);
        }

        const sourceBalBefore = Number(sourceFund.balance);
        const targetBalBefore = Number(targetFund.balance);

        // 1. Debit Source
        const newSourceBalance = sourceBalBefore - transferAmount;
        await tx.update(funds).set({ balance: String(newSourceBalance) }).where(eq(funds.id, sourceFundId));

        // 2. Credit Target
        const newTargetBalance = targetBalBefore + transferAmount;
        await tx.update(funds).set({ balance: String(newTargetBalance) }).where(eq(funds.id, targetFundId));

        // 3. Record "Out" Transaction on Source
        const [outTx] = await tx.insert(transactions).values({
            type: 'Withdrawal',
            amount: String(transferAmount),
            description: `[Transfer OUT] to ${targetFund.name}: ${description || ''}`,
            fundId: sourceFundId,
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name,
            balanceBefore: String(sourceBalBefore),
            balanceAfter: String(newSourceBalance),
            status: 'Success',
            date: new Date()
        }).returning();

        // 4. Record "In" Transaction on Target
        const [inTx] = await tx.insert(transactions).values({
            type: 'Investment',
            amount: String(transferAmount),
            description: `[Transfer IN] from ${sourceFund.name}: ${description || ''}`,
            fundId: targetFundId,
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name,
            balanceBefore: String(targetBalBefore),
            balanceAfter: String(newTargetBalance),
            status: 'Success',
            date: new Date()
        }).returning();

        return { sourceTx: outTx, targetTx: inTx };
    });

    queueStatsRecalculation();

    // Audit Log (after transaction)
    await logAudit({
        req,
        user: req.user,
        action: 'FUND_TRANSFER',
        resourceType: 'Fund',
        resourceId: targetFundId,
        details: { amount, source: sourceFundId, target: targetFundId, txIds: [result.sourceTx.id, result.targetTx.id] }
    });

    res.status(201).json({
        sourceTx: {
            ...result.sourceTx,
            amount: Number(result.sourceTx.amount),
            balanceBefore: result.sourceTx.balanceBefore ? Number(result.sourceTx.balanceBefore) : null,
            balanceAfter: result.sourceTx.balanceAfter ? Number(result.sourceTx.balanceAfter) : null
        },
        targetTx: {
            ...result.targetTx,
            amount: Number(result.targetTx.amount),
            balanceBefore: result.targetTx.balanceBefore ? Number(result.targetTx.balanceBefore) : null,
            balanceAfter: result.targetTx.balanceAfter ? Number(result.targetTx.balanceAfter) : null
        }
    });
});

// @desc    Distribute Dividends (Project or Global)
// @route   POST /api/finance/dividends
// @access  Private (Admin)
const distributeDividends = asyncHandler(async (req: any, res: any) => {
    const { type, amount: requestedAmount, projectId, sourceFundId, description } = req.body;
    const amount = Number(requestedAmount);

    if (!amount || amount <= 0) {
        res.status(400);
        throw new Error('Invalid dividend amount');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        // Idempotency / Reference for the batch
        const batchId = `DIV-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

        const activeMembers = await tx.select()
            .from(members)
            .where(and(
                eq(members.status, 'active'),
                sql`${members.shares} > 0`
            ));

        const totalActiveShares = activeMembers.reduce((sum, m) => sum + Number(m.shares), 0);

        if (totalActiveShares === 0) throw new Error('No active shares available for distribution');

        const ratePerShare = amount / totalActiveShares;

        // 1. Calculate precise distribution
        let totalDisbursed = 0;
        const dividendValues: any[] = [];

        for (const member of activeMembers) {
            // Enterprise precision: Round down to 2 decimal places to ensure we never overbalance
            const memberReward = Math.floor((Number(member.shares) * ratePerShare) * 100) / 100;
            if (memberReward <= 0) continue;

            totalDisbursed += memberReward;

            dividendValues.push({
                type: 'Dividend',
                amount: String(memberReward),
                description: description || `Dividend Distribution: ${type} Settlement [${batchId}]`,
                memberId: member.id,
                projectId: type === 'Project' ? projectId : null,
                fundId: type === 'Global' ? sourceFundId : null,
                date: new Date(),
                status: 'Success',
                referenceNumber: batchId,
                authorizedBy: req.user.id,
                createdBy: req.user.id,
                updatedBy: req.user.id,
                handlingOfficer: req.user.name
            });
        }

        if (dividendValues.length === 0) throw new Error('Calculated reward per member is too small for distribution');

        // 2. Adjust Source (Project or Fund) by the ACTUAL disbursed amount
        let sourceDisplayName = '';
        if (type === 'Project') {
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
            if (!project) throw new Error('Target Project not found');
            if (Number(project.currentFundBalance) < totalDisbursed) {
                throw new Error(`Insufficient project balance. Required: ${totalDisbursed}, Available: ${Number(project.currentFundBalance)}`);
            }
            const newBalance = Number(project.currentFundBalance) - totalDisbursed;
            await tx.update(projects).set({ currentFundBalance: String(newBalance) }).where(eq(projects.id, projectId));
            sourceDisplayName = `Project: ${project.title}`;
        } else {
            const [fund] = await tx.select().from(funds).where(eq(funds.id, sourceFundId)).limit(1);
            if (!fund) throw new Error('Source Fund not found');
            if (Number(fund.balance) < totalDisbursed) {
                throw new Error(`Insufficient fund balance. Required: ${totalDisbursed}, Available: ${Number(fund.balance)}`);
            }
            const newBalance = Number(fund.balance) - totalDisbursed;
            await tx.update(funds).set({ balance: String(newBalance) }).where(eq(funds.id, sourceFundId));
            sourceDisplayName = `Fund: ${fund.name}`;
        }

        // 3. Batch insert transactions
        await tx.insert(transactions).values(dividendValues);

        // 4. Audit Log
        await tx.insert(auditLogs).values({
            user: req.user.id,
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
                recipientsCount: dividendValues.length,
                source: sourceDisplayName
            },
            status: 'SUCCESS'
        });

        return {
            batchId,
            count: dividendValues.length,
            totalDisbursed,
            residual: amount - totalDisbursed
        };
    });

    queueStatsRecalculation();

    res.status(201).json({
        success: true,
        ...result,
        message: 'Dividends distributed successfully'
    });
});

// @desc    Transfer Equity (Member Discontinuation)
// @route   POST /api/finance/equity/transfer
// @access  Private (Admin)
const transferEquity = asyncHandler(async (req: any, res: any) => {
    const { fromMemberId, transfers, reason } = req.body; // transfers: [{ toMemberId, amount, shares }]

    if (!fromMemberId || !transfers || !Array.isArray(transfers) || transfers.length === 0) {
        res.status(400);
        throw new Error('Invalid transfer request');
    }

    const db = getDb();

    await db.transaction(async (tx) => {
        const batchId = `EQT-${Date.now()}`;
        const [sourceMember] = await tx.select().from(members).where(eq(members.id, fromMemberId)).limit(1);
        if (!sourceMember) throw new Error('Source member not found');

        const totalBeingTransferred = transfers.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
        const totalSharesTransferred = transfers.reduce((sum: number, t: any) => sum + Number(t.shares || 0), 0);

        if (totalBeingTransferred > Number(sourceMember.totalContributed || 0)) {
            throw new Error(`Insufficient contribution balance. Transfer: ${totalBeingTransferred}, Owned: ${Number(sourceMember.totalContributed)}`);
        }
        if (totalSharesTransferred > Number(sourceMember.shares)) {
            throw new Error(`Insufficient shares. Transfer: ${totalSharesTransferred}, Owned: ${Number(sourceMember.shares)}`);
        }

        const recipientValues: any[] = [];
        for (const t of transfers) {
            if (t.toMemberId === fromMemberId) {
                throw new Error('Self-transfer of equity is not permitted');
            }

            const [targetMember] = await tx.select().from(members).where(eq(members.id, t.toMemberId)).limit(1);
            if (!targetMember) throw new Error(`Target member ${t.toMemberId} not found`);
            if (targetMember.status !== 'active') throw new Error(`Target member ${targetMember.name} is not active`);

            const targetNewContributed = Number(targetMember.totalContributed || 0) + Number(t.amount);
            const targetNewShares = Number(targetMember.shares) + Number(t.shares);
            await tx.update(members).set({
                totalContributed: String(targetNewContributed),
                shares: targetNewShares
            }).where(eq(members.id, t.toMemberId));

            // Record the transfer for the recipient
            recipientValues.push({
                type: 'Equity-Transfer',
                amount: String(Number(t.amount)),
                description: `Equity Migration: Received from ${sourceMember.name} [Reference: ${reason}]`,
                memberId: targetMember.id,
                date: new Date(),
                status: 'Success',
                referenceNumber: batchId,
                authorizedBy: req.user.id,
                createdBy: req.user.id,
                updatedBy: req.user.id,
                handlingOfficer: req.user.name
            });
        }

        if (recipientValues.length > 0) {
            await tx.insert(transactions).values(recipientValues);
        }

        // Deduct from source
        const sourceNewContributed = Math.max(0, Number(sourceMember.totalContributed || 0) - totalBeingTransferred);
        const sourceNewShares = Math.max(0, Number(sourceMember.shares) - totalSharesTransferred);

        const updateData: any = {
            totalContributed: String(sourceNewContributed),
            shares: sourceNewShares,
            updatedAt: new Date()
        };

        // Auto-inactivate if fully drained
        if (sourceNewContributed === 0 && sourceNewShares === 0) {
            updateData.status = 'inactive';
        }

        await tx.update(members).set(updateData).where(eq(members.id, fromMemberId));

        // Record the transfer for the source
        await tx.insert(transactions).values({
            type: 'Equity-Transfer',
            amount: String(totalBeingTransferred),
            description: `Equity Migration: Transferred to ${transfers.length} recipient(s) [Reference: ${reason}]`,
            memberId: sourceMember.id,
            date: new Date(),
            status: 'Success',
            referenceNumber: batchId,
            authorizedBy: req.user.id,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            handlingOfficer: req.user.name
        });

        // Audit Log
        await tx.insert(auditLogs).values({
            user: req.user.id,
            userName: req.user.name,
            action: 'TRANSFER_EQUITY',
            resourceType: 'Member',
            resourceId: fromMemberId,
            details: {
                batchId,
                from: sourceMember.name,
                totalAmount: totalBeingTransferred,
                totalShares: totalSharesTransferred,
                recipients: transfers.map((t: any) => ({ id: t.toMemberId, amount: t.amount, shares: t.shares })),
                reason
            },
            status: 'SUCCESS'
        });
    });

    queueStatsRecalculation();
    res.status(200).json({ success: true, batchId: `EQT-${Date.now()}`, message: 'Equity transfer completed successfully' });
});

// @desc    Reconcile Fund (Audit Balance Integrity)
// @route   POST /api/finance/funds/:id/reconcile
// @access  Private (Admin)
const reconcileFund = asyncHandler(async (req: any, res: any) => {
    const db = getDb();

    const [fund] = await db.select().from(funds).where(eq(funds.id, req.params.id)).limit(1);
    if (!fund) {
        res.status(404);
        throw new Error('Fund not found');
    }

    // Aggregate all successful transactions for this fund
    const txSummary = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('Deposit', 'Earning', 'Investment') THEN amount::numeric ELSE 0 END), 0) as total_in,
        COALESCE(SUM(CASE WHEN type IN ('Expense', 'Withdrawal', 'Dividend', 'Adjustment') THEN amount::numeric ELSE 0 END), 0) as total_out
      FROM transactions
      WHERE fund_id = ${fund.id} AND status IN ('Success', 'Completed')
    `);

    const stats = txSummary[0] || { total_in: 0, total_out: 0 };
    const calculatedBalance = Number(stats.total_in) - Number(stats.total_out);
    let isMatched = Math.abs(calculatedBalance - Number(fund.balance)) < 0.01;
    let projectMismatch = false;

    if (fund.linkedProjectId) {
        const [project] = await db.select().from(projects).where(eq(projects.id, fund.linkedProjectId)).limit(1);
        if (project && Math.abs(Number(fund.balance) - Number(project.currentFundBalance)) > 0.01) {
            isMatched = false;
            projectMismatch = true;
        }
    }

    await db.update(funds).set({
        lastReconciledAt: new Date(),
        reconciliationStatus: isMatched ? 'VERIFIED' : 'DISCREPANCY',
        updatedAt: new Date()
    }).where(eq(funds.id, req.params.id));

    res.json({
        fund: fund.name,
        actualBalance: Number(fund.balance),
        calculatedBalance,
        isMatched,
        inflow: Number(stats.total_in),
        outflow: Number(stats.total_out),
        discrepancy: calculatedBalance - Number(fund.balance),
        projectMismatch
    });
});

// @desc    Bulk Add Deposits
// @route   POST /api/finance/deposits/bulk
// @access  Private (Admin/Manager)
const bulkAddDeposits = asyncHandler(async (req: any, res: any) => {
    const { fundId, deposits, commonMonth, cashierName } = req.body;

    if (!fundId || !deposits || !Array.isArray(deposits) || deposits.length === 0) {
        res.status(400);
        throw new Error('Invalid bulk deposit data');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, fundId)).limit(1);
        if (!fund) throw new Error('Target fund not found');

        const batchId = `BLK-${Date.now()}`;
        const results: any[] = [];
        let totalBatchAmount = 0;

        // Track entries to prevent exact duplicates (Same Member + Same Month)
        const seenEntries = new Set<string>();

        for (const dep of deposits) {
            const { memberId, amount, shareNumber, depositMonth, date } = dep;
            const month = depositMonth || commonMonth;
            const entryKey = `${memberId}-${month}`;

            if (seenEntries.has(entryKey)) {
                throw new Error(`Duplicate entry detected: Member ID ${memberId} is already in this batch for ${month}`);
            }
            seenEntries.add(entryKey);

            const [member] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
            if (!member) throw new Error(`Member with ID ${memberId} not found`);

            const depositAmount = Number(amount);
            if (isNaN(depositAmount) || depositAmount <= 0) {
                throw new Error(`Invalid amount for member ${member.name}`);
            }

            // Check for existing deposit with same member, amount, and month
            const depositDate = resolveDepositDate({ date, depositMonth: month });
            const startOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth(), 1);
            const endOfMonth = new Date(depositDate.getFullYear(), depositDate.getMonth() + 1, 0, 23, 59, 59);

            const [existingDeposit] = await tx.select()
                .from(transactions)
                .where(and(
                    eq(transactions.type, 'Deposit'),
                    eq(transactions.memberId, member.id),
                    eq(transactions.fundId, fund.id),
                    gte(transactions.date, startOfMonth),
                    lte(transactions.date, endOfMonth),
                    inArray(transactions.status, ['Success', 'Completed'])
                ))
                .limit(1);

            if (existingDeposit) {
                throw new Error(`Duplicate deposit detected: Member ${member.name} already has a deposit in ${month} (Transaction ID: ${existingDeposit.id})`);
            }

            // Update Member - ONLY totalContributed, NEVER shares
            const newContributed = Number(member.totalContributed || 0) + depositAmount;
            await tx.update(members).set({
                totalContributed: String(newContributed)
            }).where(eq(members.id, member.id));

            // Create Transaction
            const [txn] = await tx.insert(transactions).values({
                type: 'Deposit',
                amount: String(depositAmount),
                description: `Bulk Deposit [${month}]`,
                memberId: member.id,
                fundId: fund.id,
                date: depositDate,
                status: 'Completed',
                authorizedBy: req.user.id,
                createdBy: req.user.id,
                updatedBy: req.user.id,
                handlingOfficer: req.user.name || cashierName || 'System',
                depositMethod: 'Cash',
                referenceNumber: batchId,
                balanceBefore: String(Number(fund.balance) + totalBatchAmount),
                balanceAfter: String(Number(fund.balance) + totalBatchAmount + depositAmount)
            }).returning();

            totalBatchAmount += depositAmount;
            results.push({
                member: member.name,
                amount: depositAmount,
                txId: txn.id
            });
        }

        // Update Fund Balance
        const newFundBalance = Number(fund.balance) + totalBatchAmount;
        await tx.update(funds).set({ balance: String(newFundBalance) }).where(eq(funds.id, fundId));

        // Audit Log
        await tx.insert(auditLogs).values({
            user: req.user.id,
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
        });

        return {
            batchId,
            totalAmount: totalBatchAmount,
            count: deposits.length,
            results
        };
    });

    queueStatsRecalculation();

    res.status(201).json({
        success: true,
        ...result
    });
});

export {
    getTransactions,
    addDeposit,
    editDeposit,
    approveDeposit,
    addExpense,
    editExpense,
    addEarning,
    deleteTransaction,
    transferFunds,
    distributeDividends,
    transferEquity,
    reconcileFund,
    bulkAddDeposits
};
