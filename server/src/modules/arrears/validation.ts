import { z } from 'zod';

export const calculateArrearsSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, 'Period key must be in YYYY-MM format').optional(),
  monthlyDueAmount: z.number().positive().optional(),
});

export const waiveArrearSchema = z.object({
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(500),
});
