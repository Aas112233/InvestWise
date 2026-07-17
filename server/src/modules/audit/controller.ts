import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as auditService from './service.js';

/**
 * GET /api/audit
 * Paginated audit logs with filters.
 */
export const getAuditLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.getAuditLogs(req.query as Record<string, string>);
  res.json(result);
});

/**
 * GET /api/audit/metadata
 * Distinct action types and resource types.
 */
export const getAuditMetadataHandler = asyncHandler(async (_req: Request, res: Response) => {
  const metadata = await auditService.getAuditMetadata();
  res.json(metadata);
});

/**
 * GET /api/audit/notifications
 * Recent notifications from the last 48 hours.
 */
export const getNotificationsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const notifications = await auditService.getNotifications();
  res.json(notifications);
});
