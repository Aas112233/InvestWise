import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().transform((e: string) => e.toLowerCase().trim()),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  password: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
  role: z.enum(['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member']).default('Member'),
  memberId: z.string().optional(),
  permissions: z.record(z.string()).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().transform(e => e.toLowerCase().trim()).optional(),
  role: z.enum(['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  permissions: z.record(z.string()).optional(),
  memberId: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
});

export const adminPasswordResetSchema = z.object({
  password: z.string().min(12).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`])/, 'Must include uppercase, lowercase, digit, and special character'),
});
