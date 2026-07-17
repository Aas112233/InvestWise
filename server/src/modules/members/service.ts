import crypto from 'node:crypto';

import { eq, and, ilike, or, inArray, sql, count, desc, asc, isNotNull, type SQLWrapper } from 'drizzle-orm';

import { getDb } from '../../config/database.js';
import { members, users, transactions, projectMembers } from '../../db/schema/index.js';
import { hashPassword } from '../../lib/password.js';
import { NotFoundError, ConflictError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import type { PaginatedResponse } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateMemberInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  shares: number;
  status: string;
  avatar?: string;
}

export interface UpdateMemberInput {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  status?: string;
  avatar?: string;
  // shares is intentionally excluded — shares are derived from totalContributed / shareValueBdt
  // and cannot be manually changed. Use deposit/equity-transfer to adjust.
}

export interface OnboardMemberInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  shares: number;
  systemAccess: boolean;
  password?: string;
  userRole: string;
  status: string;
}

export interface ListMembersQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  status?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whitelist of sortable columns mapped to drizzle column references. */
const SORTABLE_COLUMNS: Record<string, unknown> = {
  name: members.name,
  email: members.email,
  role: members.role,
  status: members.status,
  shares: members.shares,
  memberId: members.memberId,
  totalContributed: members.totalContributed,
  lastActive: members.lastActive,
  createdAt: members.createdAt,
  updatedAt: members.updatedAt,
};

/** Reusable member field selection (without user-join fields). */
const MEMBER_FIELDS = {
  id: members.id,
  memberId: members.memberId,
  name: members.name,
  email: members.email,
  phone: members.phone,
  role: members.role,
  shares: members.shares,
  totalContributed: members.totalContributed,
  status: members.status,
  avatar: members.avatar,
  lastActive: members.lastActive,
  hasUserAccess: members.hasUserAccess,
  userId: members.userId,
  createdBy: members.createdBy,
  updatedBy: members.updatedBy,
  createdAt: members.createdAt,
  updatedAt: members.updatedAt,
} as const;

/**
 * Generates the next sequential member ID (MEM-XXXX).
 * Falls back to a UUID-based ID if the sequential counter exceeds 9999
 * or the candidate ID is already taken.
 */
async function generateMemberId(): Promise<string> {
  const db = getDb();

  const [result] = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${members.memberId} FROM 5) AS INTEGER)), 0)`,
    })
    .from(members)
    .where(sql`${members.memberId} ~ '^MEM-[0-9]{4}$'`);

  const nextNum = (result?.maxNum ?? 0) + 1;

  if (nextNum > 9999) {
    return `MEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }

  const candidate = `MEM-${String(nextNum).padStart(4, '0')}`;

  // Double-check for race-condition collision on the candidate
  const [collision] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.memberId, candidate))
    .limit(1);

  if (collision) {
    return `MEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Paginated member list with optional search, sort, and status/role filters.
 * Includes a correlated subquery for total successful deposit amounts.
 */
export async function listMembers(params: ListMembersQuery): Promise<
  PaginatedResponse<
    Record<string, unknown> & { totalDeposits: string }
  >
> {
  const db = getDb();
  const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(params);

  // ---- where clause ----
  const conditions: (SQLWrapper | undefined)[] = [];

  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(
      or(
        ilike(members.name, pattern),
        ilike(members.email, pattern),
        ilike(members.memberId, pattern),
      ),
    );
  }

  if (params.status) {
    conditions.push(eq(members.status, params.status));
  }

  if (params.role) {
    conditions.push(eq(members.role, params.role));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ---- ordering ----
  const sortColumn = (SORTABLE_COLUMNS[sortBy] as typeof members.createdAt) ?? members.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  // ---- single query: data + window count + deposit subquery ----
  const rows = await db
    .select({
      ...MEMBER_FIELDS,
      totalCount: sql<number>`COUNT(*) OVER()`,
      totalDeposits: sql<string>`
        COALESCE((
          SELECT SUM(${transactions.amount})::decimal(15,2)
          FROM ${transactions}
          WHERE ${transactions.memberId} = ${members.id}
            AND ${transactions.type} = 'Deposit'
            AND ${transactions.status} = 'Completed'
            AND ${transactions.isDeleted} = false
        ), '0.00')
      `,
    })
    .from(members)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(skip);

  const totalCount = rows.length > 0 ? Number(rows[0].totalCount) : 0;
  const data = rows.map(({ totalCount: _, ...rest }) => rest);

  return formatPaginatedResponse(data, page, limit, totalCount);
}

/**
 * Fetch a single member by UUID, including linked user info if present.
 */
export async function getMemberById(id: string) {
  const db = getDb();

  const rows = await db
    .select({
      // Member fields
      id: members.id,
      memberId: members.memberId,
      name: members.name,
      email: members.email,
      phone: members.phone,
      role: members.role,
      shares: members.shares,
      totalContributed: members.totalContributed,
      status: members.status,
      avatar: members.avatar,
      lastActive: members.lastActive,
      hasUserAccess: members.hasUserAccess,
      userId: members.userId,
      createdBy: members.createdBy,
      updatedBy: members.updatedBy,
      createdAt: members.createdAt,
      updatedAt: members.updatedAt,
      // User fields (aliased)
      uId: users.id,
      uName: users.name,
      uEmail: users.email,
      uRole: users.role,
      uStatus: users.status,
      uLastLogin: users.lastLogin,
    })
    .from(members)
    .leftJoin(users, eq(members.userId, users.id))
    .where(eq(members.id, id))
    .limit(1);

  if (rows.length === 0) {
    throw new NotFoundError('Member');
  }

  const r = rows[0];

  return {
    id: r.id,
    memberId: r.memberId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    shares: r.shares,
    totalContributed: r.totalContributed,
    status: r.status,
    avatar: r.avatar,
    lastActive: r.lastActive,
    hasUserAccess: r.hasUserAccess,
    userId: r.userId,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: r.uId
      ? {
          id: r.uId,
          name: r.uName,
          email: r.uEmail,
          role: r.uRole,
          status: r.uStatus,
          lastLogin: r.uLastLogin,
        }
      : null,
  };
}

/**
 * Create a new member with an auto-generated MEM-XXXX ID.
 * Enforces email uniqueness.
 */
export async function createMember(data: CreateMemberInput) {
  const db = getDb();

  // Email uniqueness check
  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.email, data.email))
    .limit(1);

  if (existing) {
    throw new ConflictError('A member with this email already exists');
  }

  // Generate member ID (with retry fallback for race conditions)
  let memberId = await generateMemberId();
  let attempt = 0;

  while (attempt < 2) {
    try {
      const [inserted] = await db
        .insert(members)
        .values({
          memberId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          role: data.role,
          shares: data.shares,
          status: data.status,
          ...(data.avatar ? { avatar: data.avatar } : {}),
        })
        .returning();

      return inserted;
    } catch (err: unknown) {
      const pgErr = err as { code?: string; constraint?: string };
      // Unique violation (23505) on memberId — retry with a fresh ID
      if (pgErr?.code === '23505' && pgErr?.constraint?.includes?.('member_id')) {
        memberId = `MEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        attempt++;
        continue;
      }
      // Unique violation on email — a concurrent request beat us
      if (pgErr?.code === '23505' && pgErr?.constraint?.includes?.('email')) {
        throw new ConflictError('A member with this email already exists');
      }
      throw err;
    }
  }

  throw new Error('Failed to create member after retry');
}

/**
 * Partially update a member. Enforces email uniqueness when changing email.
 */
export async function updateMember(id: string, data: UpdateMemberInput) {
  const db = getDb();

  // Confirm the member exists
  const [existing] = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('Member');
  }

  // Email uniqueness check (exclude self)
  if (data.email && data.email !== existing.email) {
    const [dup] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.email, data.email), sql`${members.id} <> ${id}`))
      .limit(1);

    if (dup) {
      throw new ConflictError('A member with this email already exists');
    }
  }

  const [updated] = await db
    .update(members)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(members.id, id))
    .returning();

  return updated;
}

/**
 * Hard-delete a member only when there are no:
 * - linked non-deleted transactions,
 * - project memberships,
 * - linked user accounts.
 */
export async function deleteMember(id: string): Promise<{ message: string }> {
  const db = getDb();

  // Confirm exists
  const [member] = await db
    .select({
      id: members.id,
      memberId: members.memberId,
      userId: members.userId,
      name: members.name,
    })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);

  if (!member) {
    throw new NotFoundError('Member');
  }

  // Safety checks
  const [txn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.memberId, id), eq(transactions.isDeleted, false)))
    .limit(1);

  if (txn) {
    throw new ConflictError(
      `Cannot delete "${member.name}" — they have active transactions. Archive the transactions first.`,
    );
  }

  const [projMember] = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.memberId, id))
    .limit(1);

  if (projMember) {
    throw new ConflictError(
      `Cannot delete "${member.name}" — they are assigned to a project. Remove them from the project first.`,
    );
  }

  if (member.userId) {
    throw new ConflictError(
      `Cannot delete "${member.name}" — they have a linked user account. Delete the user account first or unlink it.`,
    );
  }

  await db.delete(members).where(eq(members.id, id));

  return { message: `Member "${member.name}" (${member.memberId}) deleted successfully` };
}

/**
 * Onboard a member and optionally create a linked user account.
 * Runs inside a database transaction for atomicity.
 * The password is hashed with bcrypt before storage.
 */
export async function onboardMember(data: OnboardMemberInput) {
  const db = getDb();

  // Generate member ID outside the transaction (retried on collision)
  const memberId = await generateMemberId();

  const result = await db.transaction(async (tx) => {
    // Member email uniqueness
    const [existingMember] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, data.email))
      .limit(1);

    if (existingMember) {
      throw new ConflictError('A member with this email already exists');
    }

    // Create member
    const [member] = await tx
      .insert(members)
      .values({
        memberId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        shares: data.shares,
        status: data.status,
        hasUserAccess: data.systemAccess,
      })
      .returning();

    let userAccount: typeof users.$inferSelect | null = null;

    if (data.systemAccess) {
      if (!data.password) {
        throw new ConflictError('Password is required when systemAccess is enabled');
      }

      // User email uniqueness
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, data.email))
        .limit(1);

      if (existingUser) {
        throw new ConflictError('A user with this email already exists');
      }

      const hashedPassword = await hashPassword(data.password);

      [userAccount] = await tx
        .insert(users)
        .values({
          name: data.name,
          email: data.email,
          password: hashedPassword,
          role: data.userRole,
          status: data.status,
          memberId: member.memberId,
        })
        .returning();

      // Link user to member
      await tx
        .update(members)
        .set({
          userId: userAccount.id,
          hasUserAccess: true,
          updatedAt: new Date(),
        })
        .where(eq(members.id, member.id));
    }

    return { member, user: userAccount };
  });

  return result;
}

/**
 * Recalculate totalContributed for every member by aggregating
 * completed, non-deleted deposit and withdrawal transactions.
 * Members are processed in chunks of 1000.
 */
export async function recalculateFinancials(): Promise<{ updated: number }> {
  const db = getDb();

  const allMembers = await db
    .select({ id: members.id })
    .from(members);

  let updated = 0;

  for (let i = 0; i < allMembers.length; i += 1000) {
    const chunk = allMembers.slice(i, i + 1000);
    const ids = chunk.map((m) => m.id);

    // Aggregate deposit / withdrawal totals for this chunk
    const totals = await db
      .select({
        memberId: transactions.memberId,
        totalDeposits: sql<string>`
          COALESCE(SUM(
            CASE
              WHEN ${transactions.type} = 'Deposit' THEN ${transactions.amount}::decimal(15,2)
              ELSE 0
            END
          ), 0)::decimal(15,2)
        `,
        totalWithdrawals: sql<string>`
          COALESCE(SUM(
            CASE
              WHEN ${transactions.type} = 'Withdrawal' THEN ${transactions.amount}::decimal(15,2)
              ELSE 0
            END
          ), 0)::decimal(15,2)
        `,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.memberId, ids),
          eq(transactions.isDeleted, false),
          eq(transactions.status, 'Completed'),
          isNotNull(transactions.memberId),
        ),
      )
      .groupBy(transactions.memberId);

    // Index by memberId for O(1) lookup
    const totalsByMember = new Map(totals.map((t) => [t.memberId, t]));

    // Update each member in the chunk
    for (const memberId of ids) {
      const t = totalsByMember.get(memberId);
      const deposits = t ? parseFloat(t.totalDeposits) : 0;
      const withdrawals = t ? parseFloat(t.totalWithdrawals) : 0;
      const net = Math.max(0, deposits - withdrawals);

      await db
        .update(members)
        .set({
          totalContributed: net.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(members.id, memberId));

      updated++;
    }
  }

  return { updated };
}
