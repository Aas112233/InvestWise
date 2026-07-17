import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as analyticsService from './service.js';

/**
 * GET /api/analytics/stats
 * Return global dashboard statistics.
 */
export const getStatsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await analyticsService.getStats();
  res.json(stats);
});

/**
 * POST /api/analytics/recalculate
 * Force a full recalculation of all statistics.
 */
export const triggerRecalculateHandler = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await analyticsService.recalculateAllStats();
  res.json({ message: 'Stats recalculated successfully', stats });
});
