import { z } from 'zod';

const uuidField = z.string().uuid('Must be a valid UUID');
const positiveAmount = z.number().positive('Amount must be positive').min(0.01, 'Minimum amount is 0.01').max(10_000_000, 'Maximum amount is 10,000,000');

export const depositSchema = z.object({
  memberId: uuidField,
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').optional(),
  date: z.string().optional(),
  shareNumber: z.number().optional(),
  status: z.enum(['Completed', 'Processing', 'Pending']).optional(),
  cashierName: z.string().optional(),
  depositMethod: z.string().optional(),
  depositMonth: z.string().optional(),
});

export const expenseSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').optional(),
  category: z.string().max(100, 'Category max 100 characters').optional(),
  date: z.string().optional(),
  memberId: uuidField.optional(),
  projectId: uuidField.optional(),
  type: z.string().optional(),
});

export const earningSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  projectId: uuidField.optional(),
  description: z.string().max(500, 'Description max 500 characters').optional(),
  category: z.string().optional(),
  date: z.string().optional(),
  type: z.string().optional(),
});

export const transferSchema = z.object({
  sourceFundId: uuidField,
  targetFundId: uuidField,
  amount: positiveAmount,
  description: z.string().optional(),
});

const dividendSchemaBase = z.object({
  type: z.enum(['Global', 'Project']),
  amount: positiveAmount,
  projectId: uuidField.optional(),
  sourceFundId: uuidField.optional(),
  description: z.string().optional(),
});

export const dividendSchema = dividendSchemaBase.refine(
  (data: z.infer<typeof dividendSchemaBase>) => {
    if (data.type === 'Project' && !data.projectId) return false;
    if (data.type === 'Global' && !data.sourceFundId) return false;
    return true;
  },
  {
    message: 'Project type requires projectId; Global type requires sourceFundId',
    path: ['type'],
  },
);

export const equityTransferSchema = z.object({
  fromMemberId: uuidField,
  transfers: z
    .array(
      z.object({
        toMemberId: uuidField,
        amount: z.number().min(0, 'Amount cannot be negative').optional(),
        shares: z.number().min(0.01, 'Minimum shares is 0.01'),
      }),
    )
    .min(1, 'At least one transfer recipient is required'),
  reason: z.string(),
});

export const bulkDepositSchema = z.object({
  fundId: uuidField,
  commonMonth: z.string().optional(),
  cashierName: z.string().optional(),
  depositMethod: z.string().optional(),
  deposits: z
    .array(
      z.object({
        memberId: uuidField,
        amount: positiveAmount,
        shareNumber: z.number().optional(),
        depositMonth: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .min(1, 'At least one deposit is required'),
});

export type DepositInput = z.infer<typeof depositSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type EarningInput = z.infer<typeof earningSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type DividendInput = z.infer<typeof dividendSchema>;
export type EquityTransferInput = z.infer<typeof equityTransferSchema>;
export type BulkDepositInput = z.infer<typeof bulkDepositSchema>;
