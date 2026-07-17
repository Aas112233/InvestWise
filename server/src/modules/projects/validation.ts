import { z } from 'zod';

export const createProjectSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  initialInvestment: z.number().min(0).default(0),
  budget: z.number().min(0).default(0),
  expectedRoi: z.number().min(0).default(0),
  totalShares: z.number().int().min(0).default(0),
  status: z.enum(['In Progress', 'Completed', 'Review', 'On Hold']).default('In Progress'),
  health: z.enum(['Stable', 'At Risk', 'Critical']).default('Stable'),
  startDate: z.string().min(1, 'Start date is required'),
  completionDate: z.string().optional(),
  projectFundHandler: z.string().optional(),
  linkedFundId: z.string().uuid().optional(),
  involvedMembers: z
    .array(
      z.object({
        memberId: z.string().uuid(),
        sharesInvested: z.number().int().min(0).default(0),
      }),
    )
    .optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const projectUpdateSchema = z.object({
  type: z.enum(['Earning', 'Expense', 'Adjustment']),
  amount: z.number().min(0.01).max(10_000_000),
  description: z.string().min(1).max(500),
  date: z.string().optional(),
});
