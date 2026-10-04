import { z } from 'zod';
import { ROLES } from '@/lib/roles';

const USER_STATUSES = ['active', 'inactive', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one of name, role or status must be provided',
  });

export const passwordResetSchema = z.object({
  password: z.string().min(1, 'password is required').max(200),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

type Validated<T> = { ok: true; value: T } | { ok: false; message: string; code: string };

/** AGENTS.md §11: `[Field '<field>', Code: <code>] <message>`. */
export function validateUserUpdateInput(body: unknown): Validated<UserUpdateInput> {
  const result = userUpdateSchema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return toFieldError(result.error.issues);
}

export function validatePasswordResetInput(body: unknown): Validated<{ password: string }> {
  const result = passwordResetSchema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  return toFieldError(result.error.issues);
}

function toFieldError(
  issues: readonly { path: PropertyKey[]; code: string; message: string }[]
): { ok: false; message: string; code: string } {
  const issue = issues[0];
  const field = issue?.path?.join('.') || 'body';
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: `[Field '${field}', Code: ${issue?.code || 'invalid_type'}] ${issue?.message || 'Invalid input'}`,
  };
}
