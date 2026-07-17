import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as reportsService from './service.js';

/**
 * GET /api/reports/generate/:type
 * Generate a report of the given type with optional query params.
 */
export const generateReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type as string;
  const format = (req.query.format as string) || 'json';
  const params = { ...req.query, ...req.params };
  delete params.format;
  delete params.type;

  const report = await reportsService.generateReport(type, format, params);
  res.json(report);
});

/**
 * POST /api/reports/export-generic
 * Export arbitrary columns+rows data as a structured report.
 */
export const exportGenericReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { columns, rows } = req.body;
  const result = await reportsService.exportGeneric({ columns, rows });
  res.json(result);
});
