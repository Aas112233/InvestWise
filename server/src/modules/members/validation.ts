import { z } from 'zod';

const ROLES = ['Admin', 'Administrator', 'Manager', 'Audit', 'Investor', 'Associate Member', 'Member'] as const;

export const createMemberSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  phone: z.string().nullable().optional(),
  role: z.enum(ROLES).default('Member'),
  shares: z.number().int().min(1, 'Shares must be at least 1').default(1),
  status: z.enum(['active', 'inactive']).default('active'),
  avatar: z.string().nullable().optional(),
  nidOrPassport: z.string().nullable().optional(),
  fatherName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  nomineeName: z.string().nullable().optional(),
  nomineeRelation: z.string().nullable().optional(),
  nomineeNidOrPassport: z.string().nullable().optional(),
  nomineePhone: z.string().nullable().optional(),
});

// Shares are locked after creation — derived from totalContributed / shareValueBdt
export const updateMemberSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().transform(e => e.toLowerCase().trim()).optional(),
  phone: z.string().nullable().optional(),
  role: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  avatar: z.string().nullable().optional(),
  nidOrPassport: z.string().nullable().optional(),
  fatherName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  nomineeName: z.string().nullable().optional(),
  nomineeRelation: z.string().nullable().optional(),
  nomineeNidOrPassport: z.string().nullable().optional(),
  nomineePhone: z.string().nullable().optional(),
  hasUserAccess: z.boolean().optional(),
  systemAccess: z.boolean().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').nullable().optional(),
  userRole: z.string().optional(),
});

export const onboardMemberSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().transform(e => e.toLowerCase().trim()),
  phone: z.string().nullable().optional(),
  role: z.string().default('Member'),
  shares: z.number().int().min(1, 'Shares must be at least 1').default(1),
  systemAccess: z.boolean().default(false),
  password: z.string().nullable().optional(),
  userRole: z.string().default('Member'),
  status: z.enum(['active', 'inactive']).default('active'),
  nidOrPassport: z.string().nullable().optional(),
  fatherName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  nomineeName: z.string().nullable().optional(),
  nomineeRelation: z.string().nullable().optional(),
  nomineeNidOrPassport: z.string().nullable().optional(),
  nomineePhone: z.string().nullable().optional(),
});
