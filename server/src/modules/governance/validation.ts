import { z } from 'zod';

const uuidField = z.string().uuid('Must be a valid UUID');

export const issuePenaltySchema = z.object({
  memberId: uuidField,
  meetingId: uuidField.nullable().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  title: z.string().max(255).nullable().optional(),
  type: z.enum(['VERBAL_WARNING', 'FUND_DEDUCTION', 'SUSPENSION']).optional(),
  deductionAmount: z.number().min(0).optional(),
  isPercentage: z.boolean().optional(),
  fundId: uuidField.nullable().optional(),
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(1000),
});

export const waivePenaltySchema = z.object({
  waiveReason: z.string().min(3, 'Waive reason must be at least 3 characters').max(500),
});

export const adjustScoreSchema = z.object({
  newScore: z.number().min(0).max(100),
  reason: z.string().min(3).max(500).nullable().optional(),
});
