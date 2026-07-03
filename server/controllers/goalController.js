import asyncHandler from 'express-async-handler';
import cache from '../utils/cache.js';
import { getDb } from '../db/connection.js';
import { goals } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

// @desc Fetch all goals for a user
// @route GET /api/goals
// @access Private
const getGoals = asyncHandler(async (req, res) => {
  const db = getDb();
  const userId = req.user.id || req.user._id;
  const allGoals = await db.select().from(goals).where(eq(goals.userId, userId));
  res.json(allGoals);
});

// @desc Fetch a single goal by ID
// @route GET /api/goals/:id
// @access Private
const getGoalById = asyncHandler(async (req, res) => {
  const db = getDb();
  const [goal] = await db.select().from(goals).where(eq(goals.id, req.params.id)).limit(1);

  if (!goal) {
    res.status(404);
    throw new Error('Goal not found');
  }

  if (goal.userId !== (req.user.id || req.user._id)) {
    res.status(401);
    throw new Error('Not authorized to view this goal');
  }

  res.json(goal);
});

// @desc Create a new goal
// @route POST /api/goals
// @access Private
const createGoal = asyncHandler(async (req, res) => {
  const { title, description, targetAmount, currentAmount, deadline, type, linkedProject } = req.body;
  const db = getDb();

  const [createdGoal] = await db.insert(goals).values({
    userId: req.user.id || req.user._id,
    title,
    description: description || null,
    targetAmount: String(targetAmount),
    currentAmount: currentAmount !== undefined ? String(currentAmount) : '0',
    deadline: deadline ? new Date(deadline) : null,
    type: type || 'Other',
    projectId: linkedProject || null,
  }).returning();

  res.status(201).json(createdGoal);
});

// @desc Update a goal
// @route PUT /api/goals/:id
// @access Private
const updateGoal = asyncHandler(async (req, res) => {
  const db = getDb();
  const [goal] = await db.select().from(goals).where(eq(goals.id, req.params.id)).limit(1);

  if (goal) {
    if (goal.userId !== (req.user.id || req.user._id)) {
      res.status(401);
      throw new Error('Not authorized to update this goal');
    }

    const [updatedGoal] = await db.update(goals).set({
      title: req.body.title || goal.title,
      description: req.body.description !== undefined ? req.body.description : goal.description,
      targetAmount: req.body.targetAmount !== undefined ? String(req.body.targetAmount) : goal.targetAmount,
      currentAmount: req.body.currentAmount !== undefined ? String(req.body.currentAmount) : goal.currentAmount,
      deadline: req.body.deadline !== undefined ? (req.body.deadline ? new Date(req.body.deadline) : null) : goal.deadline,
      status: req.body.status || goal.status,
      type: req.body.type || goal.type,
      projectId: req.body.linkedProject !== undefined ? req.body.linkedProject : goal.projectId,
      updatedAt: new Date(),
    }).where(eq(goals.id, req.params.id)).returning();

    res.json(updatedGoal);
  } else {
    res.status(404);
    throw new Error('Goal not found');
  }
});

// @desc Delete a goal
// @route DELETE /api/goals/:id
// @access Private
const deleteGoal = asyncHandler(async (req, res) => {
  const db = getDb();
  const [goal] = await db.select().from(goals).where(eq(goals.id, req.params.id)).limit(1);

  if (goal) {
    if (goal.userId !== (req.user.id || req.user._id)) {
      res.status(401);
      throw new Error('Not authorized to delete this goal');
    }

    await db.delete(goals).where(eq(goals.id, req.params.id));
    res.json({ message: 'Goal removed' });
  } else {
    res.status(404);
    throw new Error('Goal not found');
  }
});

export { getGoals, getGoalById, createGoal, updateGoal, deleteGoal };
