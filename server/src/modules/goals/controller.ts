import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as goalService from './service.js';

export const getGoals = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const result = await goalService.listGoals(userId, req.query as Record<string, string | undefined>);
  res.json(result);
});

export const getGoalById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const goal = await goalService.getGoalById(userId, req.params.id as string);
  res.json(goal);
});

export const createGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const goal = await goalService.createGoal(userId, req.body);
  res.status(201).json(goal);
});

export const updateGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const goal = await goalService.updateGoal(userId, req.params.id as string, req.body);
  res.json(goal);
});

export const deleteGoal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await goalService.deleteGoal(userId, req.params.id as string);
  res.json({ message: 'Goal removed' });
});
