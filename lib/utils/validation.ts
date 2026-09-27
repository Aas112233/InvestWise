import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().transform((e: string) => e.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  password: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
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
  newPassword: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
});

export const adminPasswordResetSchema = z.object({
  password: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
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
      language: z.enum(['English', 'Bengali']).optional(),
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