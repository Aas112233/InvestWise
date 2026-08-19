import { z } from 'zod';

const uuidField = z.string().uuid('Must be a valid UUID');

export const createFiscalPeriodSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  periodStart: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  periodEnd: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  notes: z.string().max(1000).optional(),
});

export const closeFiscalPeriodSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export const executeProfitAllocationSchema = z.object({
  sourceFundId: uuidField,
  customAmount: z.number().positive().optional(),
});
