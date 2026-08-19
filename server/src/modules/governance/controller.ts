import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as penaltyService from './penalty-service.js';
import * as performanceService from './performance.js';

export const issuePenaltyHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await penaltyService.issuePenalty(
    req.body,
    req.user!.id,
    req.user!.name,
  );
  res.status(201).json({ success: true, message: 'Penalty issued successfully', penalty: result });
});

export const waivePenaltyHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await penaltyService.waivePenalty(
    req.params.id as string,
    req.body,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, message: 'Penalty waived and balance refunded if applicable', penalty: result });
});

export const listPenaltiesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;
  const result = await penaltyService.listMemberPenalties(query);
  res.json(result);
});

export const getMemberPenaltySummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await penaltyService.getMemberPenaltySummary(req.params.memberId as string);
  res.json(result);
});

export const getMemberPerformanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const evaluationMonths = req.query.months ? parseInt(req.query.months as string, 10) : 6;
  const result = await performanceService.calculateMemberPerformance(
    req.params.memberId as string,
    evaluationMonths,
  );
  res.json(result);
});

export const recalculateMemberPerformanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const score = await performanceService.recalculateMemberPerformance(req.params.memberId as string);
  res.json({ success: true, memberId: req.params.memberId, performanceScore: score });
});

export const recalculateAllPerformanceHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await performanceService.recalculateAllMembersPerformance();
  res.json({ success: true, message: 'All member performance scores refreshed', ...result });
});

export const getGovernanceLeaderboardHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await performanceService.getGovernanceLeaderboard();
  res.json(result);
});

export const adjustMemberPerformanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await performanceService.manuallyAdjustMemberScore(
    req.params.memberId as string,
    req.body.newScore,
    req.body.reason,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, message: 'Member score adjusted successfully', ...result });
});
