import { z } from 'zod';

/**
 * Financial mutation contracts (Zod v3 — legacy server tree pins zod ^3).
 * Amounts cross the boundary as numbers/strings and are re-validated in
 * integer cents inside the service layer (amount > 0, <= 2dp, ceiling
 * enforced — §12).
 */

const uuidField = z.string().uuid('Must be a valid UUID');
const positiveAmount = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .positive('Amount must be positive')
  .min(0.01, 'Minimum amount is 0.01')
  .max(10_000_000, 'Maximum amount is 10,000,000');

export const depositSchema = z.object({
  memberId: uuidField,
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').nullish(),
  date: z.string().nullish(),
  shareNumber: z.coerce.number().nullish(),
  status: z.enum(['Completed', 'Processing', 'Pending']).nullish(),
  cashierName: z.string().nullish(),
  depositMethod: z.string().nullish(),
  depositMonth: z.string().nullish(),
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
    .min(1, 'At least one deposit is required')
    .max(500, 'Maximum 500 deposits per batch'),
});

export const expenseSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').nullish(),
  category: z.string().max(100, 'Category max 100 characters').nullish(),
  date: z.string().nullish(),
  memberId: uuidField.nullish(),
  projectId: uuidField.nullish(),
});

export const earningSchema = z.object({
  amount: positiveAmount,
  fundId: uuidField,
  projectId: uuidField.nullish(),
  description: z.string().max(500, 'Description max 500 characters').nullish(),
  category: z.string().nullish(),
  date: z.string().nullish(),
});

export const transferSchema = z.object({
  sourceFundId: uuidField,
  targetFundId: uuidField,
  amount: positiveAmount,
  description: z.string().max(500).optional(),
});

const dividendSchemaBase = z.object({
  type: z.enum(['Global', 'Project']),
  amount: z.coerce
    .number()
    .positive('Amount must be positive')
    .min(0.01, 'Minimum amount is 0.01')
    .max(100_000_000, 'Maximum amount is 100,000,000'),
  projectId: uuidField.nullish(),
  sourceFundId: uuidField.nullish(),
  description: z.string().max(500).nullish(),
});

export const dividendSchema = dividendSchemaBase.superRefine((val, ctx) => {
  if (val.type === 'Project' && !val.projectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'Project type requires projectId',
    });
  }
  if (val.type === 'Global' && !val.sourceFundId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'Global type requires sourceFundId',
    });
  }
});

export const equityTransferSchema = z.object({
  fromMemberId: uuidField,
  transfers: z
    .array(
      z.object({
        toMemberId: uuidField,
        amount: z.number().min(0, 'Amount cannot be negative').optional(),
        shares: z.number().int().min(1, 'Minimum shares is 1'),
      }),
    )
    .min(1, 'At least one transfer recipient is required'),
  reason: z.string().min(1, 'Reason is required').max(500),
});

export const deleteTransactionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  searchField: z.enum(['all', 'amount', 'id', 'memberId', 'memberName', 'fundName']).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  projectId: z.string().optional(),
  memberId: z.string().optional(),
  fundId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  month: z.string().optional(),
  year: z.string().optional(),
});

export type DepositPayload = z.infer<typeof depositSchema>;
export type BulkDepositPayload = z.infer<typeof bulkDepositSchema>;
export type ExpensePayload = z.infer<typeof expenseSchema>;
export type EarningPayload = z.infer<typeof earningSchema>;
export type TransferPayload = z.infer<typeof transferSchema>;
export type DividendPayload = z.infer<typeof dividendSchema>;
export type EquityTransferPayload = z.infer<typeof equityTransferSchema>;
