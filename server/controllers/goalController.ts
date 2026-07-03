import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { goals } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import cache from '../utils/cache.js';

// ---------------------------------------------------------------------------
// Helper – safely extract the authenticated user as a plain object
// ---------------------------------------------------------------------------
interface AuthUser {
  _id: string;
  name?: string;
}

const getReqUser = (req: any): AuthUser | null => {
  if (!req?.user) return null;
  return { _id: String(req.user._id), name: req.user.name };
};

// ---------------------------------------------------------------------------
// GET /api/goals
// ---------------------------------------------------------------------------
const getGoals = asyncHandler(async (req, res) => {
  const db = getDb();
  const user = getReqUser(req);

  const goalList = await db
    .select()
    .from(goals)
    .where(eq(goals.userId, user?._id ?? ''));

  res.json(goalList);
});

// ---------------------------------------------------------------------------
// GET /api/goals/:id
// ---------------------------------------------------------------------------
const getGoalById = asyncHandler(async (req, res) => {
  const db = getDb();
  const user = getReqUser(req);
  const id = req.params.id as string;

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, id));

  if (!goal) {
    res.status(404);
    throw new Error('Goal not found');
  }

  if (goal.userId !== user?._id) {
    res.status(401);
    throw new Error('Not authorized to view this goal');
  }

  res.json(goal);
});

// ---------------------------------------------------------------------------
// POST /api/goals
// ---------------------------------------------------------------------------
const createGoal = asyncHandler(async (req, res) => {
  const db = getDb();
  const user = getReqUser(req);
  const { title, description, targetAmount, currentAmount, deadline, type, linkedProject } = req.body;

  const [goal] = await db
    .insert(goals)
    .values({
      userId: user?._id ?? '',
      title,
      description: description || null,
      targetAmount: String(targetAmount ?? 0),
      currentAmount: String(currentAmount ?? 0),
      deadline: deadline ? new Date(deadline) : null,
      type: type || 'Other',
      projectId: linkedProject || null,
    })
    .returning();

  cache.invalidateByPrefix('goals:');
  res.status(201).json(goal);
});

// ---------------------------------------------------------------------------
// PUT /api/goals/:id
// ---------------------------------------------------------------------------
const updateGoal = asyncHandler(async (req, res) => {
  const db = getDb();
  const user = getReqUser(req);
  const id = req.params.id as string;

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, id));

  if (!goal) {
    res.status(404);
    throw new Error('Goal not found');
  }

  if (goal.userId !== user?._id) {
    res.status(401);
    throw new Error('Not authorized to update this goal');
  }

  const updateData: Record<string, string | Date | null> = {};

  if (req.body.title) updateData.title = req.body.title;
  if (req.body.description !== undefined) updateData.description = req.body.description;
  if (req.body.targetAmount !== undefined) updateData.targetAmount = String(req.body.targetAmount);
  if (req.body.currentAmount !== undefined) updateData.currentAmount = String(req.body.currentAmount);
  if (req.body.deadline !== undefined) updateData.deadline = req.body.deadline ? new Date(req.body.deadline) : null;
  if (req.body.status) updateData.status = req.body.status;
  if (req.body.type) updateData.type = req.body.type;
  if (req.body.linkedProject !== undefined) updateData.projectId = req.body.linkedProject;

  if (Object.keys(updateData).length > 0) {
    const [updatedGoal] = await db
      .update(goals)
      .set(updateData)
      .where(eq(goals.id, id))
      .returning();

    cache.invalidateByPrefix('goals:');
    res.json(updatedGoal);
  } else {
    res.json(goal);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/goals/:id
// ---------------------------------------------------------------------------
const deleteGoal = asyncHandler(async (req, res) => {
  const db = getDb();
  const user = getReqUser(req);
  const id = req.params.id as string;

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, id));

  if (!goal) {
    res.status(404);
    throw new Error('Goal not found');
  }

  if (goal.userId !== user?._id) {
    res.status(401);
    throw new Error('Not authorized to delete this goal');
  }

  await db
    .delete(goals)
    .where(eq(goals.id, id));

  cache.invalidateByPrefix('goals:');
  res.json({ message: 'Goal removed' });
});

export { getGoals, getGoalById, createGoal, updateGoal, deleteGoal };
