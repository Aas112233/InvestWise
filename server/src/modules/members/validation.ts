import { z } from 'zod';

const ROLES = ['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member'] as const;

export const createMemberSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  phone: z.string().optional(),
  role: z.string().default('Member'),
  shares: z.number().int().min(1, 'Shares must be at least 1').default(1),
  status: z.enum(['active', 'inactive']).default('active'),
  avatar: z.string().optional(),
});

// Shares are locked after creation — derived from totalContributed / shareValueBdt
export const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().transform(e => e.toLowerCase().trim()).optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  avatar: z.string().optional(),
});

export const onboardMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  phone: z.string().optional(),
  role: z.string().default('Member'),
  shares: z.number().int().min(1, 'Shares must be at least 1').default(1),
  systemAccess: z.boolean().default(false),
  password: z.string().optional(),
  userRole: z.string().default('Member'),
  status: z.enum(['active', 'inactive']).default('active'),
});
