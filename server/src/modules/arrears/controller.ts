import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as arrearsService from './service.js';

export const calculateArrearsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { periodKey, monthlyDueAmount } = req.body;
  const result = await arrearsService.calculateMonthlyArrears(
    periodKey,
    monthlyDueAmount ? Number(monthlyDueAmount) : undefined,
    req.user!.id,
    req.user!.name,
  );
  res.status(200).json({ success: true, ...result });
});

export const listArrearsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;
  const result = await arrearsService.listArrears(query);
  res.json(result);
});

export const waiveArrearHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await arrearsService.waiveArrear(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
    reason,
  );
  res.json({ success: true, message: 'Arrear waived successfully', arrear: result });
});

export const getMemberArrearsHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await arrearsService.getMemberArrearsSummary(req.params.memberId as string);
  res.json(result);
});
