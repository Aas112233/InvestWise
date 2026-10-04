import { z } from 'zod';

export const NOTICE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

const noticeBase = {
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  severity: z.enum(NOTICE_SEVERITIES),
  active: z.boolean(),
  // ISO-8601 instant or null to clear. Validated as a real date, not a string.
  expiresAt: z
    .string()
    .nullish()
    .refine((v) => v === null || v === undefined || !Number.isNaN(Date.parse(v)), {
      message: 'expiresAt must be an ISO-8601 date-time',
    })
    .transform((v) => (v === undefined ? undefined : v)),
};

export const noticeCreateSchema = z.object(noticeBase);
export const noticeUpdateSchema = noticeCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one field must be provided' }
);

export type NoticeCreateInput = z.infer<typeof noticeCreateSchema>;
export type NoticeUpdateInput = z.infer<typeof noticeUpdateSchema>;

type Validated<T> = { ok: true; value: T } | { ok: false; message: string; code: string };

/**
 * AGENTS.md §11 field-error shape: `[Field '<field>', Code: <code>] <message>`,
 * so the client toast names the offending input instead of "something went
 * wrong".
 */
export function validateNoticeInput(
  body: unknown,
  opts: { partial?: boolean } = {}
): Validated<NoticeCreateInput | NoticeUpdateInput> {
  const schema = opts.partial ? noticeUpdateSchema : noticeCreateSchema;
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, value: result.data as never };

  const issue = result.error.issues[0];
  const field = issue?.path?.join('.') || 'body';
  const code = issue?.code || 'invalid_type';
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: `[Field '${field}', Code: ${code}] ${issue?.message || 'Invalid input'}`,
  };
}
