import { z } from 'zod';

/**
 * Financial mutation contracts (Zod v3 — legacy server tree pins zod ^3).
 * Amounts cross the boundary as numbers/strings and are re-validated in
 * integer cents inside the service layer (amount > 0, <= 2dp, ceiling
 * enforced — §12).
 */

const uuidField = z.string().uuid('Must be a valid UUID');

/**
 * Money at the boundary. #22/#47: the UI has emitted amounts as BOTH `2000`
 * and `"2000"` depending on the form, and the schemas disagreed about which was
 * legal (`positiveAmount` rejected strings while `dividendSchema` accepted
 * them) — so "works" vs "dead" was form-dependent. Coerce everywhere so a
 * numeric string and a number are equally valid, and let the service layer's
 * integer-cents validation own the real precision/ceiling rules.
 *
 * No `.refine()` in this chain: under zod v3 it degrades the whole object's
 * inferred type to `unknown`. `z.coerce.number()` already rejects NaN/Infinity.
 */
const moneyField = (max: number, maxMessage: string) =>
  z.coerce
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be positive')
    .min(0.01, 'Minimum amount is 0.01')
    .max(max, maxMessage);

const positiveAmount = moneyField(10_000_000, 'Maximum amount is 10,000,000');
const depositMonthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format');
const isoDateField = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Date must be a real calendar date');

export const depositSchema = z.object({
  memberId: uuidField,
  amount: positiveAmount,
  fundId: uuidField,
  description: z.string().max(500, 'Description max 500 characters').nullish(),
  date: z.string().nullish(),
  collectedDate: z.string().nullish(),
  submittedDate: z.string().nullish(),
  shareNumber: z.coerce.number().nullish(),
  status: z.enum(['Completed', 'Processing', 'Pending']).nullish(),
  cashierName: z.string().nullish(),
  depositMethod: z.string().nullish(),
  depositMonth: z.string().nullish(),
});

export const revertDepositSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason max 500 characters'),
});

/**
 * Bulk deposit batch.
 *
 * `commonMonth` is the multi-member shape (one month for every row). A
 * single-member, multi-month collection sends a month PER ROW instead, so the
 * shared month is optional — but a batch that resolves no month for a row is
 * rejected here rather than silently posting the row against today's month:
 * the write path must never guess the accounting period (§8).
 */
export const bulkDepositSchema = z
  .object({
    fundId: uuidField,
    requestKey: uuidField.optional(),
    commonMonth: depositMonthField.optional(),
    cashierName: z.string().trim().min(1).max(255).optional(),
    depositMethod: z.string().trim().min(1).max(50).optional(),
    deposits: z
      .array(
        z
          .object({
            memberId: uuidField,
            amount: positiveAmount,
            depositMonth: depositMonthField.optional(),
            date: isoDateField.optional(),
          })
          .strict(),
      )
      .min(1, 'At least one deposit is required')
      .max(500, 'Maximum 500 deposits per batch'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.commonMonth) return;
    value.deposits.forEach((deposit, index) => {
      if (deposit.depositMonth) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deposits', index, 'depositMonth'],
        message: 'A deposit month is required — send commonMonth or a depositMonth on every row',
      });
    });
  });

/**
 * GET /api/finance/deposits/month-status — the per-member deposit month grid
 * for one fiscal year. Strict: the endpoint answers exactly this question, and
 * an unknown parameter would otherwise be ignored while looking honoured.
 */
export const depositMonthStatusQuerySchema = z
  .object({
    memberId: uuidField,
    fiscalYear: z.string().regex(/^\d{4}$/, 'Fiscal year must be a four-digit year'),
  })
  .strict();

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
  referenceNumber: z.string().max(100).optional(),
  /** Effective transfer date (yyyy-mm-dd). Omitted = today. createdAt stays the operation time. */
  date: z.string().max(10).optional(),
});

const equityTransferRowSchema = z.object({
  toMemberId: uuidField,
  // Optional: a shares-only transfer needs no cash leg. Coerced for the
  // same reason as every other money field.
  amount: z.coerce.number().min(0, 'Amount cannot be negative').optional(),
  // Optional too: a contribution-only transfer moves equity without any
  // ownership change. Ceiling on "what must a row move" is on the parent.
  shares: z.coerce
    .number({ error: 'Shares must be a number' })
    .int('Shares must be a whole number')
    .min(0, 'Shares cannot be negative')
    .optional(),
});

export const equityTransferSchema = z
  .object({
    fromMemberId: uuidField,
    transfers: z.array(equityTransferRowSchema).min(1, 'At least one transfer recipient is required'),
    reason: z.string().min(1, 'Reason is required').max(500),
    /** Client retry key. A repeat of an already-recorded key is rejected rather
     *  than moving the same equity a second time. */
    referenceNumber: z.string().trim().min(3).max(120).optional(),
    /** Must be true when any row transfers shares with no contribution behind it. */
    giftAcknowledged: z.boolean().optional(),
    /** Must be true when any row transfers contribution with no shares behind it. */
    amountOnlyAcknowledged: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    // A row has to move something — shares, contribution, or both. An empty row
    // would otherwise record zero-value ledger legs for a recipient.
    val.transfers.forEach((row, index) => {
      if (!(row.shares ?? 0) && !(row.amount ?? 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transfers', index, 'shares'],
          message: 'Transfer shares, an amount, or both',
        });
      }
    });
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

