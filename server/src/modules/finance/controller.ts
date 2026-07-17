import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as financeService from './service.js';

export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;
  const result = await financeService.getTransactions(query);
  res.json(result);
});

export const addDeposit = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.addDeposit(req.body, req.user!.id, req.user!.name);
  res.status(201).json(result);
});

export const editDeposit = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.editDeposit(req.params.id as string, req.body, req.user!.id, req.user!.name);
  res.json(result);
});

export const approveDeposit = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.approveDeposit(req.params.id as string, req.user!.id, req.user!.name);
  res.json(result);
});

export const addExpense = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.addExpense(req.body, req.user!.id, req.user!.name);
  res.status(201).json(result);
});

export const editExpense = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.editExpense(req.params.id as string, req.body, req.user!.id, req.user!.name);
  res.json(result);
});

export const addEarning = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.addEarning(req.body, req.user!.id, req.user!.name);
  res.status(201).json(result);
});

export const deleteTransaction = asyncHandler(async (req: Request, res: Response) => {
  const reason = req.body?.reason;
  const result = await financeService.deleteTransaction(req.params.id as string, req.user!.id, req.user!.name, reason);
  res.json(result);
});

export const transferFunds = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.transferFunds(req.body, req.user!.id, req.user!.name);
  res.status(201).json(result);
});

export const distributeDividends = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.distributeDividends(req.body, req.user!.id, req.user!.name);
  res.status(201).json({ success: true, ...result, message: 'Dividends distributed successfully' });
});

export const transferEquity = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.transferEquity(req.body, req.user!.id, req.user!.name);
  res.status(200).json({ success: true, ...result });
});

export const reconcileFund = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.reconcileFund(req.params.id as string);
  res.json(result);
});

export const bulkAddDeposits = asyncHandler(async (req: Request, res: Response) => {
  const result = await financeService.bulkAddDeposits(req.body, req.user!.id, req.user!.name);
  res.status(201).json({ success: true, ...result });
});

// ── Financial Governance ──────────────────────────────────────────────────
import { validateWithdrawal, calculateExitSettlement } from './withdrawal-rules.js';
import { getShareConsistencyReport, recalculateAllMemberShares } from './share-consistency.js';

export const validateWithdrawalHandler = asyncHandler(async (req: Request, res: Response) => {
  const { memberId, amount, fundId } = req.body;
  res.json(await validateWithdrawal(memberId, Number(amount), fundId));
});

export const calculateExitSettlementHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await calculateExitSettlement(req.params.memberId as string));
});

export const getShareConsistencyHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getShareConsistencyReport());
});

export const recalculateSharesHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await recalculateAllMemberShares();
  res.json({ success: true, ...result, message: `Recalculated shares for ${result.updated} members` });
});
