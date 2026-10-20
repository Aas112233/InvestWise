/**
 * Shared error taxonomy for the financial API — mirrors the Express
 * error-handler contract so the client sees identical messages/codes.
 */

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

const PG_ERROR_MAP: Record<string, { status: number; message: string; code: string }> = {
  '23505': { status: 409, message: 'A record with that value already exists (duplicate key).', code: 'DUPLICATE_KEY' },
  '23503': { status: 409, message: 'This action would violate a database relationship constraint.', code: 'FK_VIOLATION' },
  '23502': { status: 400, message: 'A required field is missing (not-null violation).', code: 'NOT_NULL_VIOLATION' },
  '23514': { status: 400, message: 'The value provided does not meet the required constraints.', code: 'CHECK_VIOLATION' },
  '22003': { status: 400, message: 'A numeric value is out of range.', code: 'NUMERIC_OVERFLOW' },
  '40001': { status: 503, message: 'Database transaction conflict. Please retry.', code: 'TRANSACTION_CONFLICT' },
  '40P01': { status: 503, message: 'Deadlock detected. Please retry.', code: 'DEADLOCK' },
  '08006': { status: 503, message: 'Database connection lost. Please try again.', code: 'DB_CONNECTION_ERROR' },
  '57014': { status: 504, message: 'Database query timed out. Please try again.', code: 'QUERY_TIMEOUT' },
};

interface PgError extends Error {
  code?: string;
}

/** Normalize any thrown error into an AppError with a client-safe payload. */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Cross-tree app errors: root `lib/utils/errors.ts` classes are a SEPARATE
  // AppError hierarchy but share the { statusCode, code, message } contract.
  // Without this branch a root ValidationError (e.g. thrown by the shared
  // assertMemberNotSuspended helper) would fall into the PG check below —
  // its string `code` matches no SQLSTATE — and surface as a masked 500
  // instead of its intended 400. PG driver errors carry no numeric
  // statusCode, so this never shadows the map below.
  const appLike = err as { statusCode?: unknown; code?: unknown; message?: unknown } | null;
  if (appLike && typeof appLike === 'object' && typeof appLike.statusCode === 'number') {
    return new AppError(
      typeof appLike.message === 'string' && appLike.message ? appLike.message : 'An unexpected error occurred',
      appLike.statusCode,
      typeof appLike.code === 'string' && appLike.code ? appLike.code : 'APP_ERROR',
    );
  }

  const pgErr = err as PgError;
  if (typeof pgErr?.code === 'string') {
    const mapped = PG_ERROR_MAP[pgErr.code];
    if (mapped) {
      return new AppError(mapped.message, mapped.status, mapped.code);
    }
  }

  return new AppError('An unexpected error occurred', 500, 'INTERNAL_ERROR');
}
