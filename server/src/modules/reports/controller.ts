import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as reportsService from './service.js';
import { logAudit } from '../../lib/audit.js';

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

  const report = (await reportsService.generateReport(type, format, params)) as any;

  // Compliance trail: every financial report extraction is recorded in the audit ledger.
  const actor = req.user as { id?: string; name?: string } | undefined;
  await logAudit({
    user: actor ?? null,
    req: { ip: req.ip, headers: req.headers as Record<string, string | undefined> },
    action: 'EXPORT',
    resourceType: 'Report',
    resourceId: type,
    details: {
      format,
      period: req.query.period || null,
      date: req.query.date || null,
      projectId: req.query.projectId || null,
      memberId: req.query.memberId || null,
      fundId: req.query.fundId || null,
      rowCount: Array.isArray(report?.data) ? report.data.length : null,
      truncated: report?.truncated === true,
    },
    status: 'SUCCESS',
  });

  if (format === 'csv') {
    const rawData = Array.isArray(report?.data) ? report.data : [report];
    const csvContent = reportsService.convertToCsv(rawData);
    const safeFilename = `${type.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(csvContent);
    return;
  }

  res.json(report);
});

/**
 * POST /api/reports/export-generic
 * Export arbitrary columns+rows data as a structured report.
 */
export const exportGenericReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const { columns, rows, format } = req.body;

  if (format === 'csv' && Array.isArray(columns) && Array.isArray(rows)) {
    const headerRow = columns.join(',');
    const dataRows = rows.map((r: unknown[]) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = [headerRow, ...dataRows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export_${Date.now()}.csv"`);
    res.send(csvContent);
    return;
  }

  const result = await reportsService.exportGeneric({ columns, rows });
  res.json(result);
});
