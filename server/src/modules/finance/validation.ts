import { z } from 'zod';

const uuidField = z.string().uuid('Must be a valid UUID');
const positiveAmount = z.number().positive('Amount must be positive').min(0.01, 'Minimum amount is 0.01').max(10_000_000, 'Maximum amount is 10,000,000');

export const depositSchema = z.object({
  memberId: uuidField,
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').nullable().optional(),
  date: z.string().nullable().optional(),
  shareNumber: z.coerce.number().nullable().optional(),
  status: z.enum(['Completed', 'Processing', 'Pending']).nullable().optional(),
  cashierName: z.string().nullable().optional(),
  depositMethod: z.string().nullable().optional(),
  depositMonth: z.string().nullable().optional(),
}).passthrough();

export const expenseSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').nullable().optional(),
  category: z.string().max(100, 'Category max 100 characters').nullable().optional(),
  date: z.string().nullable().optional(),
  memberId: uuidField.nullable().optional(),
  projectId: uuidField.nullable().optional(),
  type: z.string().nullable().optional(),
}).passthrough();

export const earningSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  projectId: uuidField.nullable().optional(),
  description: z.string().max(500, 'Description max 500 characters').nullable().optional(),
  category: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
}).passthrough();

export const transferSchema = z.object({
  sourceFundId: uuidField,
  targetFundId: uuidField,
  amount: positiveAmount,
  description: z.string().optional(),
});

const dividendSchemaBase = z.object({
  type: z.enum(['Global', 'Project']),
  amount: z.coerce.number().positive('Amount must be positive').min(0.01, 'Minimum amount is 0.01').max(100_000_000, 'Maximum amount is 100,000,000'),
  projectId: uuidField.nullable().optional(),
  sourceFundId: uuidField.nullable().optional(),
  description: z.string().nullable().optional(),
}).passthrough();

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

export const executeWithdrawalSchema = z.object({
  memberId: uuidField,
  fundId: uuidField,
  amount: positiveAmount,
  description: z.string().max(500).optional(),
  withdrawalMethod: z.string().optional(),
});

export const executeExitSettlementSchema = z.object({
  memberId: uuidField,
  fundId: uuidField,
  reason: z.string().max(500).optional(),
  paymentMethod: z.string().optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type EarningInput = z.infer<typeof earningSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type DividendInput = z.infer<typeof dividendSchema>;
export type EquityTransferInput = z.infer<typeof equityTransferSchema>;
export type BulkDepositInput = z.infer<typeof bulkDepositSchema>;
export type ExecuteWithdrawalInput = z.infer<typeof executeWithdrawalSchema>;
export type ExecuteExitSettlementInput = z.infer<typeof executeExitSettlementSchema>;
