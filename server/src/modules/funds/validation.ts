import { z } from 'zod';

export const createFundSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['DEPOSIT', 'PRIMARY', 'PROJECT', 'OTHER']).default('OTHER'),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'CLOSED']).default('ACTIVE'),
  balance: z.number().min(0).default(0),
  currency: z.string().length(3).default('BDT'),
  handlingOfficer: z.string().optional(),
  accountNumber: z.string().optional(),
  initialBalance: z.number().min(0).optional(),
  linkedProjectId: z.string().uuid().optional(),
});

export const updateFundSchema = createFundSchema.partial();
