import { z } from 'zod';

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
});

export const projectCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  category: z.string().trim().min(1, 'Category is required').max(255),
  description: z.string().trim().max(10000).default(''),
  budget: z.coerce.number().min(0, 'Budget cannot be negative'),
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
  shareholders: z.array(projectShareholderSchema).default([]),
});

// Partial update: every field optional, but at least one must be present.
export const projectUpdateSchema = projectCreateSchema
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, { message: 'No valid fields to update' });

export const disbursementSchema = z.object({
  type: z.enum(['Earning', 'Expense']),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  // §12 idempotency: client-supplied reference doubles as the retry key —
  // a retry with the same reference is rejected instead of double-posting.
  referenceNumber: z.string().trim().min(1).max(255).optional(),
});

export const projectReturnDistributionSchema = z.object({
  type: z.enum(['Profit', 'Loss']),
  amount: z.coerce.number().positive('Distribution amount must be greater than zero'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  // §12 idempotency: see disbursementSchema.referenceNumber.
  referenceNumber: z.string().trim().min(1).max(255).optional(),
});

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
  role: z.enum(['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member']).default('Member'),
  memberId: z.string().optional(),
  permissions: z.record(z.string(), z.string()).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().transform(e => e.toLowerCase().trim()).optional(),
  role: z.enum(['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  memberId: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
});

export const adminPasswordResetSchema = z.object({
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
});

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
      fiscalYearStart: z.string().optional(),
      baseCurrency: z.string().max(10).optional(),
      taxRate: z.number().min(0).max(100).optional(),
      accountingMethod: z.enum(['Cash', 'Accrual']).optional(),
      shareValueBdt: z.number().positive().optional(),
      isShareValueLocked: z.boolean().optional(),
      withdrawalLimitPercent: z.number().min(0).max(100).optional(),
      withdrawalNoticeDays: z.number().int().min(0).max(365).optional(),
      maxWithdrawalPerRequest: z.number().min(0).optional(),
      statutoryReservePercent: z.number().min(0).max(100).optional(),
      fiscalYearEnd: z.string().optional(),
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
      penaltyRules: z
        .array(
          z.object({
            tier: z.number().int().min(1).max(4),
            title: z.string().min(1),
            type: z.enum(['VERBAL_WARNING', 'FUND_DEDUCTION', 'SUSPENSION']),
            deductionAmount: z.number().min(0).optional(),
            isPercentage: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;