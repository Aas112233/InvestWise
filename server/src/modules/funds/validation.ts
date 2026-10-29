import { z } from 'zod';

// An omitted/invalid code must stay undefined so the service can resolve the
// tenant's own base currency. Defaulting to 'BDT' here silently relabelled
// every fund a non-BDT tenant created or edited.
const normalizeCurrency = (val: string | null | undefined) =>
  val && val.trim().length === 3 ? val.toUpperCase() : undefined;

// RESERVE must be selectable: the statutory-retention leg of a dividend run
// requires an active RESERVE fund, so a type the API would not accept made
// distribution impossible to configure.
export const createFundSchema = z.object({
  name: z.string().min(1, 'Fund name is required'),
  type: z.string().optional().transform((val) => {
    if (!val) return 'OTHER';
    const u = val.toUpperCase();
    if (['DEPOSIT', 'PRIMARY', 'PROJECT', 'RESERVE', 'EMERGENCY', 'OTHER'].includes(u)) return u;
    return 'OTHER';
  }),
  description: z.string().nullable().optional(),
  status: z.string().optional().transform((val) => {
    if (!val) return 'ACTIVE';
    const u = val.toUpperCase();
    if (['ACTIVE', 'INACTIVE', 'CLOSED'].includes(u)) return u;
    return 'ACTIVE';
  }),
  currency: z.string().optional().transform(normalizeCurrency),
  handlingOfficer: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  initialBalance: z.union([z.number(), z.string().transform((v) => Number(v) || 0)]).optional(),
  minimumBalance: z.union([z.number(), z.string().transform((v) => Number(v) || 0)]).optional(),
  linkedProjectId: z.string().nullable().optional().transform((val) => (val && val.trim() !== '' ? val : null)),
});

export const updateFundSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const u = val.toUpperCase();
    if (['DEPOSIT', 'PRIMARY', 'PROJECT', 'RESERVE', 'EMERGENCY', 'OTHER'].includes(u)) return u;
    return 'OTHER';
  }),
  description: z.string().nullable().optional(),
  status: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const u = val.toUpperCase();
    if (['ACTIVE', 'INACTIVE', 'CLOSED'].includes(u)) return u;
    return 'ACTIVE';
  }),
  minimumBalance: z.union([z.number(), z.string().transform((v) => Number(v) || 0)]).optional(),
  currency: z.string().nullable().optional().transform(normalizeCurrency),
  handlingOfficer: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  linkedProjectId: z.string().nullable().optional().transform((val) => (val && val.trim() !== '' ? val : null)),
});
