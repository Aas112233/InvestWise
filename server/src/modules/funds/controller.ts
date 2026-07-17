import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as fundService from './service.js';

export const getFunds = asyncHandler(async (req: Request, res: Response) => {
  const { type, status } = req.query as { type?: string; status?: string };
  const result = await fundService.listFunds(type, status, req.query as Record<string, string | undefined>);
  res.json(result);
});

export const getFundById = asyncHandler(async (req: Request, res: Response) => {
  const fund = await fundService.getFundById(req.params.id as string);
  res.json(fund);
});

export const createFund = asyncHandler(async (req: Request, res: Response) => {
  const fund = await fundService.createFund(req.body);
  res.status(201).json(fund);
});

export const updateFund = asyncHandler(async (req: Request, res: Response) => {
  const fund = await fundService.updateFund(req.params.id as string, req.body);
  res.json(fund);
});

export const deleteFund = asyncHandler(async (req: Request, res: Response) => {
  await fundService.deleteFund(req.params.id as string);
  res.json({ message: 'Fund removed' });
});
