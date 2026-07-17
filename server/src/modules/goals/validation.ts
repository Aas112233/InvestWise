import { z } from 'zod';

export const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  targetAmount: z.number().min(0.01),
  currentAmount: z.number().min(0).default(0),
  deadline: z.string().optional(), // ISO date
  type: z.enum(['Savings', 'Investment', 'Other']).default('Other'),
  status: z.enum(['In Progress', 'Completed', 'Cancelled']).default('In Progress'),
  linkedProject: z.string().uuid().optional(),
});

export const updateGoalSchema = createGoalSchema.partial();
