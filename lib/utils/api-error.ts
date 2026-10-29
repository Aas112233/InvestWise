import { NextResponse } from 'next/server';
import { AppError } from './errors';

/**
 * Uniform catch-block response for App Router routes (audit 07 M-3).
 *
 * Operational errors — AppError subclasses (ValidationError, AuthError,
 * ForbiddenError, NotFoundError, ConflictError, LockedError, …) and any
 * non-AppError that deliberately carries a 4xx statusCode — are returned
 * verbatim: §11 requires the real server message to reach the toast, never
 * a masked "Something went wrong".
 *
 * Everything else is an UNEXPECTED failure. Raw driver/ORM exceptions wrap
 * the SQL text ("Failed query: …") in `err.message`; letting that through
 * leaks schema and query structure to authenticated clients. Those get the
 * route's static fallback message and are logged here with a grep-able tag
 * (routes that already console.error will simply log twice — harmless).
 */
export function apiError(err: unknown, fallbackMessage: string): NextResponse {
  const e = err as { statusCode?: number; message?: string } | null;
  const statusCode = e?.statusCode;
  const hasValidStatus = typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599;
  const status = hasValidStatus ? (statusCode as number) : 500;
  const operational = err instanceof AppError || (hasValidStatus && (statusCode as number) < 500);

  if (operational) {
    const body: { success: false; message: string; code?: string } = {
      success: false,
      message: e?.message || fallbackMessage,
    };
    const code = (err as { code?: string } | null)?.code;
    if (typeof code === 'string' && code) body.code = code;
    return NextResponse.json(body, { status });
  }

  console.error('[API_ERROR_MASKED]', fallbackMessage, err);
  return NextResponse.json({ success: false, message: fallbackMessage }, { status });
}
