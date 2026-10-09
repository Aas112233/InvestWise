import { z } from 'zod';
import { MEMBER_ROLES } from '@/lib/member-roles';

/**
 * Member create/update body schemas (AGENTS.md: Zod in route handlers).
 * Previously POST/PUT /api/members hand-rolled every check, so the two doors
 * could grow different rules for the same field; the vocabulary and length
 * limits now live here once.
 */

/**
 * Optional trimmed text with a hard ceiling, coerced to null when absent or
 * blank — the declarative twin of lib/utils/types.optionalStringField, so a
 * value that creates cleanly can never be rejected on the first edit.
 */
function optionalText(max: number, label: string) {
  return z.preprocess(
    (v) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s === '' ? null : s;
    },
    z.string().max(max, `${label} must be at most ${max} characters`).nullable(),
  );
}

const kycFields = {
  nidOrPassport: optionalText(100, 'NID/Passport'),
  fatherName: optionalText(255, "Father's name"),
  address: optionalText(500, 'Address'),
  nomineeName: optionalText(255, 'Nominee name'),
  nomineeRelation: optionalText(100, 'Nominee relation'),
  nomineeNidOrPassport: optionalText(100, 'Nominee NID/Passport'),
  nomineePhone: optionalText(50, 'Nominee phone'),
};

// members.name and members.email are varchar(255) in the database. Without a
// max here a longer value passes validation and then fails inside the INSERT as
// Postgres 22001, which surfaces as a 500 instead of a field error.
const NAME_MAX = 255;
const EMAIL_MAX = 255;

const emailField = z
  .string()
  .trim()
  .min(1, 'Valid email is required')
  .max(EMAIL_MAX, `Email must be at most ${EMAIL_MAX} characters`)
  .email('Valid email is required');

// An empty-string role is the form's "nothing picked yet" state (§15): it
// means default-on-create / leave-alone-on-update, never "invalid value".
const memberRoleField = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.enum(MEMBER_ROLES).optional(),
);

export const memberCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`),
  email: emailField,
  // phone is NOT NULL in the schema — required on create and edit alike.
  phone: z.string().trim().min(1, 'Phone is required').max(50, 'Phone must be at most 50 characters'),
  // Membership CATEGORY (lib/member-roles vocabulary — never an authz role).
  role: memberRoleField,
  shares: z.coerce.number().int('Shares must be a whole number').min(1, 'Shares must be at least 1').optional(),
  status: z.enum(['active', 'inactive']).optional(),
  ...kycFields,
});

export const memberUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters`)
    .optional(),
  email: emailField.optional(),
  phone: z.string().trim().min(1, 'Phone is required').max(50, 'Phone must be at most 50 characters').optional(),
  role: memberRoleField,
  // schema only guarantees a well-formed number reaches that check.
  shares: z.coerce.number().int('Shares must be a whole number').min(1, 'Shares must be at least 1').optional(),
  status: z.enum(['active', 'inactive', 'pending', 'suspended']).optional(),
  avatar: z.string().trim().max(500).optional().nullable(),
  ...kycFields,
});

/** First-issue field error in the §11 wire format, matching the plans kernel. */
export function memberFieldError(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'body';
  return {
    success: false,
    message: `[Field '${field}', Code: ${issue?.code || 'invalid_type'}] ${issue?.message || 'Invalid input'}`,
    code: 'VALIDATION_ERROR',
  };
}
