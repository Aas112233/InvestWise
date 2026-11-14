import { z } from 'zod';
import { MEMBER_ROLES } from '@/lib/member-roles';
import { PROJECT_MEMBER_ROLE } from '@/lib/distribution-rules';

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

/**
 * Deposit cap for the exclusive 'Project Member' category (lib/deposit-cap.ts
 * owns the runtime semantics): blank/absent → null, otherwise a positive
 * money-shaped number ≤ the platform ceiling. Non-Project-Members must not
 * send it — the route-level checks enforce which roles may carry a cap.
 */
const depositCapField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? null : v),
  z
    .coerce
    .number('Deposit cap must be a number')
    .positive('Deposit cap must be greater than zero')
    .max(10_000_000, 'Deposit cap exceeds the maximum allowed')
    .refine(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6,
      'Deposit cap has more than 2 decimal places',
    )
    .nullable(),
);

/** Optional project uuid — the Project Member's single bound project. */
const projectIdField = z.preprocess(
  (v) => (v === undefined || v === null || v === '' ? undefined : v),
  z.string().uuid('Project must be a valid selection').optional(),
);

export const memberCreateSchema = z
  .object({
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
    /** Lifetime deposit ceiling — required for, and only for, Project Members. */
    depositCap: depositCapField.optional(),
    /** The single project a new Project Member is bound to — required for them. */
    projectId: projectIdField,
    ...kycFields,
  })
  .superRefine((d, ctx) => {
    if (d.role !== PROJECT_MEMBER_ROLE) {
      if (d.depositCap !== undefined && d.depositCap !== null) {
        ctx.addIssue({ code: 'custom', path: ['depositCap'], message: `A deposit cap applies only to ${PROJECT_MEMBER_ROLE}s` });
      }
      if (d.projectId !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['projectId'], message: `A bound project applies only to ${PROJECT_MEMBER_ROLE}s` });
      }
      return;
    }
    // Project Member invariants (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §3.2):
    // no club shares, cap set BEFORE/at creation, exactly one bound project.
    if (d.depositCap === undefined || d.depositCap === null) {
      ctx.addIssue({ code: 'custom', path: ['depositCap'], message: 'A Project Member needs a deposit cap before it can be created' });
    }
    if (d.projectId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['projectId'], message: `A Project Member must be bound to one project at creation` });
    }
    if (d.shares !== undefined && d.shares !== 0) {
      ctx.addIssue({ code: 'custom', path: ['shares'], message: `A ${PROJECT_MEMBER_ROLE} holds no club shares` });
    }
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
  /**
   * Member type lock escape hatch (lib/member-role-lock.ts): required to
   * change a locked member type, ignored when nothing is locked. Only an
   * authz Admin may use it, and the reason lands in the audit trail. Blank
   * strings normalize to absent (§15) — the lock error, not a zod noise, is
   * what a half-filled override should surface as.
   */
  roleOverrideReason: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().min(1, 'An override reason is required').max(500),
  ).optional(),
  // schema only guarantees a well-formed number reaches that check.
  shares: z.coerce.number().int('Shares must be a whole number').min(1, 'Shares must be at least 1').optional(),
  status: z.enum(['active', 'inactive', 'pending', 'suspended']).optional(),
  avatar: z.string().trim().max(500).optional().nullable(),
  /**
   * Editable lifetime deposit ceiling for Project Members (raise or lower —
   * lowering never removes existing equity; lib/deposit-cap.ts enforces the
   * runtime rule). The role/cap cross-checks run in PUT /api/members/[id]
   * because they need the STORED row, not just the payload.
   */
  depositCap: depositCapField.optional(),
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
