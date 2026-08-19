import { z } from 'zod';

export const createProjectSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  initialInvestment: z.coerce.number().min(0).default(0),
  budget: z.coerce.number().min(0).default(0),
  expectedRoi: z.coerce.number().min(0).default(0),
  totalShares: z.coerce.number().int().min(0).default(0),
  status: z.enum(['In Progress', 'Completed', 'Review', 'On Hold']).default('In Progress'),
  health: z.enum(['Stable', 'At Risk', 'Critical']).default('Stable'),
  startDate: z.string().min(1, 'Start date is required'),
  completionDate: z.string().nullable().optional(),
  projectFundHandler: z.string().nullable().optional(),
  linkedFundId: z.string().uuid().nullable().optional(),
  involvedMembers: z
    .array(
      z.object({
        memberId: z.string(),
        sharesInvested: z.coerce.number().int().min(0).default(0),
      }).passthrough(),
    )
    .optional(),
}).passthrough();

export const updateProjectSchema = createProjectSchema.partial().passthrough();

export const projectUpdateSchema = z.object({
  type: z.enum(['Earning', 'Expense', 'Adjustment']),
  amount: z.coerce.number().min(0.01).max(10_000_000),
  description: z.string().min(1).max(500),
  date: z.string().nullable().optional(),
}).passthrough();
