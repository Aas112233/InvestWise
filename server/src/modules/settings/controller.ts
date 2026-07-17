import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as settingsService from './service.js';

/**
 * GET /api/settings
 * Return the current system settings.
 */
export const getSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await settingsService.getSettings();
  res.json(settings);
});

/**
 * PUT /api/settings
 * Partially update system settings (admin only).
 */
export const updateSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await settingsService.updateSettings(req.body);
  res.json(updated);
});

/**
 * GET /api/settings/share-value-status
 * Check whether the share value is locked and the count of transactions.
 */
export const getShareValueStatusHandler = asyncHandler(async (_req: Request, res: Response) => {
  const status = await settingsService.getShareValueStatus();
  res.json(status);
});
