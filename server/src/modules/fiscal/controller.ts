import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as fiscalService from './service.js';
import * as allocationService from './profit-allocation.js';

export const createFiscalPeriodHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await fiscalService.createFiscalPeriod(req.body);
  res.status(201).json({ success: true, ...result });
});

export const listFiscalPeriodsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await fiscalService.listFiscalPeriods();
  res.json(result);
});

export const getFiscalPeriodByIdHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await fiscalService.getFiscalPeriodById(req.params.id as string);
  res.json(result);
});

export const closeFiscalPeriodHandler = asyncHandler(async (req: Request, res: Response) => {
  const { notes } = req.body;
  const result = await fiscalService.closeFiscalPeriod(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
    notes,
  );
  res.json({ success: true, message: 'Fiscal period closed successfully', period: result });
});

export const reopenFiscalPeriodHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await fiscalService.reopenFiscalPeriod(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, message: 'Fiscal period reopened successfully', period: result });
});

export const executeProfitAllocationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sourceFundId, customAmount } = req.body;
  const result = await allocationService.executeProfitAllocation(
    req.params.id as string,
    sourceFundId,
    customAmount ? Number(customAmount) : undefined,
    req.user!.id,
    req.user!.name,
  );
  res.status(201).json({ success: true, ...result, message: 'Profit allocation executed successfully' });
});

export const listProfitAllocationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await allocationService.listProfitAllocations(req.params.id as string);
  res.json(result);
});
