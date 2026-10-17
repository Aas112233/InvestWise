import { z } from 'zod';
import { PAYMENT_TYPES } from '@/lib/payment-methods';
import { fiscalYearEndForStart } from '@/lib/fiscal-periods';

export const loginSchema = z.object({
  email: z.string().email().transform((e: string) => e.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

// Projects (§6 Zod in route handlers, §8 ISO dates on the wire, §12 money bounds).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (label: string) => z.string().regex(ISO_DATE_RE, `${label} must be yyyy-mm-dd`);
export const PROJECT_STATUSES = ['In Progress', 'Review', 'Completed', 'Cancelled'] as const;
export const PROJECT_HEALTHS = ['Stable', 'At Risk', 'Critical'] as const;

export const projectShareholderSchema = z.object({
  memberId: z.string().uuid('Invalid member ID'),
  shares: z.coerce.number().int().min(1, 'Shares must be at least 1'),
  // Fund the invested capital is drawn FROM. Optional so legacy clients still
  // parse; the create route requires it whenever a shareholder is present,
  // because capital with no source fund is money created from nowhere (§12).
  sourceFundId: z.string().uuid('Invalid source fund ID').nullable().optional(),
});

export const projectCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  category: z.string().trim().min(1, 'Category is required').max(255),
  description: z.string().trim().max(10000).default(''),
  // Normalized to 2dp here so route-side money math (toCents) never rejects an
  // over-precise planning figure with a 500.
  budget: z.coerce
    .number()
    .min(0, 'Budget cannot be negative')
    .transform((v) => Math.round(v * 100) / 100),
  initialInvestment: z.coerce.number().min(0).default(0),
  expectedRoi: z.coerce.number().min(0).max(100, 'Expected ROI must be 0-100').default(0),
  status: z.enum(PROJECT_STATUSES).default('In Progress'),
  health: z.enum(PROJECT_HEALTHS).default('Stable'),
  startDate: isoDate('Start date'),
  completionDate: isoDate('Completion date').nullable().optional(),
  linkedFundId: z.string().uuid().nullable().optional(),
  createNewFund: z.boolean().default(false).optional(),
  newFundName: z.string().trim().max(255).nullable().optional(),
  projectFundHandler: z.string().trim().max(255).nullable().optional(),
  shareholders: z.array(projectShareholderSchema).max(1000, 'Too many shareholders in one project').default([]),
});

// Partial update: every field optional, but at least one must be present.
export const projectUpdateSchema = projectCreateSchema
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, { message: 'No valid fields to update' });

export const disbursementSchema = z.object({
  type: z.enum(['Earning', 'Expense']),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  // #107: user-picked posting date (ISO). Omitted = server "now" (legacy
  // clients). Future-dating is rejected in the route (with clock-skew slack).
  date: z.string().trim().min(1).max(40).optional(),
  // #107: optional project associate member who handled the posting. Name
  // entry only — recorded as handlingOfficer + transaction memberId; it does
  // NOT move the member's balance (member equity derives from Deposit/Dividend
  // rows only).
  handledByMemberId: z.string().trim().uuid('handledByMemberId must be a valid member id').optional(),
  // §12 idempotency: client-supplied reference doubles as the retry key —
  // a retry with the same reference is rejected instead of double-posting.
  referenceNumber: z.string().trim().min(1).max(255).optional(),
});

export const projectReturnDistributionSchema = z
  .object({
    // Settle & close: the server computes the legs from the project's locked
    // balance (the ENTIRE remaining balance) and, after posting, marks the
    // project Completed and permanently locks it (is_locked). Client-supplied
    // type/amount are ignored on a settle run.
    settleProject: z.boolean().optional(),
    type: z.enum(['Profit', 'Loss', 'Both']).optional(),
    // Profit leg (the full loss amount when type === 'Loss'). Required > 0
    // for custom runs; omitted on settle runs.
    amount: z.coerce.number().min(0, 'Distribution amount must be greater than zero').optional(),
    // 'Both' only: the loss leg, settled after the profit leg in one atomic run.
    lossAmount: z.coerce.number().positive('Loss amount must be greater than zero').optional(),
    description: z.string().trim().min(1, 'Description is required').max(500),
    // §12 idempotency: see disbursementSchema.referenceNumber.
    referenceNumber: z.string().trim().min(1).max(255).optional(),
    // Optional fund recipients (profit leg): each fund gets `percent` of the
    // distribution; shareholders pro-rata split the remaining percentage.
    // Percent is at most 2dp; duplicates and sums > 100% are rejected
    // server-side with exact integer basis-point math.
    fundAllocations: z
      .array(
        z.object({
          fundId: z.string().trim().min(1).max(64),
          percent: z.coerce.number().positive('Fund percent must be greater than zero').max(100, 'Fund percent must be at most 100'),
        }),
      )
      .max(50, 'At most 50 funds can receive a distribution')
      .optional(),
  })
  .refine((d) => d.settleProject || d.type !== undefined, {
    message: 'Distribution type is required',
    path: ['type'],
  })
  .refine((d) => d.settleProject || (d.amount ?? 0) > 0, {
    message: 'Distribution amount must be greater than zero',
    path: ['amount'],
  })
  .refine((d) => !(d.type === 'Loss' && (d.fundAllocations?.length ?? 0) > 0), {
    message: 'Fund allocations are only allowed for Profit distributions',
    path: ['fundAllocations'],
  })
  .refine((d) => d.type !== 'Both' || (d.lossAmount ?? 0) > 0, {
    message: 'Both requires a lossAmount (the loss leg)',
    path: ['lossAmount'],
  });

const fiscalMonthName = z.enum([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

export const updateSettingsSchema = z.object({
  organization: z
    .object({
      companyName: z.string().max(150).optional(),
      companyTagline: z.string().max(255).optional(),
      companyAddress: z.string().max(255).optional(),
      companyEmail: z.string().email().or(z.literal('')).optional(),
      companyPhone: z.string().max(50).optional(),
      companyWebsite: z.string().max(100).optional(),
      companyRegNo: z.string().max(50).optional(),
    })
    .optional(),
  financial: z
    .object({
      fiscalYearStart: fiscalMonthName.optional(),
      baseCurrency: z.string().max(10).optional(),
      taxRate: z.number().min(0).max(100).optional(),
      accountingMethod: z.enum(['Cash', 'Accrual']).optional(),
      shareValueBdt: z.coerce.number().positive().optional(),
      isShareValueLocked: z.boolean().optional(),
      withdrawalLimitPercent: z.number().min(0).max(100).optional(),
      withdrawalNoticeDays: z.number().int().min(0).max(365).optional(),
      maxWithdrawalPerRequest: z.number().min(0).optional(),
      statutoryReservePercent: z.number().min(0).max(100).optional(),
      fiscalYearEnd: fiscalMonthName.optional(),
    })
    .superRefine((financial, ctx) => {
      if (financial.fiscalYearStart && financial.fiscalYearEnd) {
        // A fiscal year is always a full 12-month run: the end month must be
        // exactly 11 months after the start. Only "start === end" was rejected
        // before, so a 3-month "year" (January→March) was accepted and then
        // fed every fiscal helper that assumes 12 slots — Analysis bucketed 3
        // months of data into 12 bars and marked members MISSED for months
        // outside their fiscal year altogether.
        if (fiscalYearEndForStart(financial.fiscalYearStart) !== financial.fiscalYearEnd) {
          ctx.addIssue({
            code: 'custom',
            path: ['fiscalYearEnd'],
            message: 'The fiscal year end month must be the month before the start month (a full 12-month year)',
          });
        }
      }
    })
    .optional(),
  system: z
    .object({
      language: z.enum(['English', 'Bengali', 'Urdu', 'Hindi']).optional(),
      refreshInterval: z.string().optional(),
      theme: z.enum(['Light', 'Dark', 'System Default']).optional(),
      dateFormat: z.string().optional(),
      isMaintenanceMode: z.boolean().optional(),
    })
    .optional(),
  governance: z
    .object({
      monthlyMeetingDay: z.number().int().min(1).max(28).optional(),
      depositDueDate: z.number().int().min(1).max(28).optional(),
      gracePeriodDays: z.number().int().min(0).max(30).optional(),
      /** Months after a period during which a late deposit still settles it. */
      lateDepositGraceMonths: z.number().int().min(0).max(6).optional(),
      /** Months without a deposit before a member is auto-held. */
      inactiveAfterMonths: z.number().int().min(1).max(36).optional(),
      /** Months without a deposit before a member becomes suspension-eligible. */
      suspendedAfterMonths: z.number().int().min(2).max(60).optional(),
      meetingTypes: z.array(z.string().min(1)).optional(),
      /**
       * Tenant-configurable payment methods (deposit forms list these). Name
       * is free text the org sets; type is one of the fixed channel
       * categories in lib/payment-methods.ts.
       */
      paymentMethods: z
        .array(
          z.object({
            name: z.string().trim().min(1, 'Payment method name is required').max(40),
            type: z.enum(PAYMENT_TYPES),
          }),
        )
        .max(20, 'At most 20 payment methods')
        .superRefine((list, ctx) => {
          const seen = new Set<string>();
          for (const m of list) {
            const key = m.name.toLowerCase();
            if (seen.has(key)) {
              ctx.addIssue({ code: 'custom', message: `Duplicate payment method name: ${m.name}` });
            }
            seen.add(key);
          }
        })
        .optional(),
      penaltyRules: z
        .array(
          z.object({
            tier: z.number().int().min(1).max(4),
            title: z.string().min(1),
            type: z.enum(['VERBAL_WARNING', 'FUND_DEDUCTION', 'SUSPENSION']),
            deductionAmount: z.coerce.number().min(0).optional(),
            isPercentage: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;