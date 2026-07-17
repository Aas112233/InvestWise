import { getDb } from '../../config/database.js';
import { goals } from '../../db/schema/index.js';
import { eq, desc, asc, sql, type SQL } from 'drizzle-orm';
import { NotFoundError, ForbiddenError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import type { PaginatedResponse } from '../../shared/types.js';
import { cache } from '../../lib/cache.js';

const GOALS_CACHE_KEY = 'goals:list';
const GOALS_CACHE_TTL = 30_000; // 30 seconds

export interface CreateGoalData {
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount?: number;
  deadline?: string;
  type?: 'Savings' | 'Investment' | 'Other';
  status?: 'In Progress' | 'Completed' | 'Cancelled';
  linkedProject?: string;
}

export interface UpdateGoalData {
  title?: string;
  description?: string;
  targetAmount?: number;
  currentAmount?: number;
  deadline?: string;
  type?: 'Savings' | 'Investment' | 'Other';
  status?: 'In Progress' | 'Completed' | 'Cancelled';
  linkedProject?: string;
}

export async function listGoals(
  userId: string,
  query?: Record<string, string | undefined>,
): Promise<PaginatedResponse<typeof goals.$inferSelect>> {
  const cacheKey = `${GOALS_CACHE_KEY}:${userId}:${JSON.stringify(query ?? {})}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      const db = getDb();
      const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(query ?? {}, {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      // Safe sort column whitelist
      const SORT_MAP: Record<string, unknown> = {
        title: goals.title,
        targetAmount: goals.targetAmount,
        currentAmount: goals.currentAmount,
        status: goals.status,
        deadline: goals.deadline,
        createdAt: goals.createdAt,
        updatedAt: goals.updatedAt,
      };
      const sortCol = (SORT_MAP[sortBy] as typeof goals.createdAt) ?? goals.createdAt;
      const orderFn = sortOrder === 'asc' ? asc : desc;

      // Single query: data + total count via window function (saves one DB round-trip)
      const rows = await db
        .select({
          goal: goals,
          totalCount: sql<number>`COUNT(*) OVER()`,
        })
        .from(goals)
        .where(eq(goals.userId, userId))
        .orderBy(orderFn(sortCol))
        .limit(limit)
        .offset(skip);

      const totalCount = rows.length > 0 ? Number(rows[0].totalCount) : 0;
      const data = rows.map((r) => r.goal);

      return formatPaginatedResponse(data, page, limit, totalCount);
    },
    GOALS_CACHE_TTL,
  );
}

export async function getGoalById(userId: string, goalId: string) {
  const db = getDb();

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) {
    throw new NotFoundError('Goal');
  }

  if (goal.userId !== userId) {
    throw new ForbiddenError('Not authorized to view this goal');
  }

  return goal;
}

export async function createGoal(userId: string, data: CreateGoalData) {
  const db = getDb();

  const [goal] = await db
    .insert(goals)
    .values({
      userId,
      title: data.title,
      description: data.description ?? null,
      targetAmount: String(data.targetAmount),
      currentAmount: String(data.currentAmount ?? 0),
      deadline: data.deadline || null,
      type: data.type || 'Other',
      status: data.status || 'In Progress',
      linkedProjectId: data.linkedProject ?? null,
    })
    .returning();

  cache.delByPrefix(`${GOALS_CACHE_KEY}:${userId}`);
  return goal;
}

export async function updateGoal(userId: string, goalId: string, data: UpdateGoalData) {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!existing) {
    throw new NotFoundError('Goal');
  }

  if (existing.userId !== userId) {
    throw new ForbiddenError('Not authorized to update this goal');
  }

  const updateFields: Record<string, unknown> = {};

  if (data.title !== undefined) updateFields.title = data.title;
  if (data.description !== undefined) updateFields.description = data.description;
  if (data.targetAmount !== undefined) updateFields.targetAmount = String(data.targetAmount);
  if (data.currentAmount !== undefined) updateFields.currentAmount = String(data.currentAmount);
  if (data.deadline !== undefined) updateFields.deadline = data.deadline ? new Date(data.deadline) : null;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.type !== undefined) updateFields.type = data.type;
  if (data.linkedProject !== undefined) updateFields.linkedProjectId = data.linkedProject;

  if (Object.keys(updateFields).length === 0) {
    return existing;
  }

  const [updated] = await db
    .update(goals)
    .set(updateFields)
    .where(eq(goals.id, goalId))
    .returning();

  cache.delByPrefix(`${GOALS_CACHE_KEY}:${userId}`);
  return updated;
}

export async function deleteGoal(userId: string, goalId: string) {
  const db = getDb();

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) {
    throw new NotFoundError('Goal');
  }

  if (goal.userId !== userId) {
    throw new ForbiddenError('Not authorized to delete this goal');
  }

  await db
    .delete(goals)
    .where(eq(goals.id, goalId));

  cache.delByPrefix(`${GOALS_CACHE_KEY}:${userId}`);
}
