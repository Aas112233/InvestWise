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

/** Share-value lock: settings immutable once transactions exist (AGENTS.md §12). */
export class LockedError extends AppError {
  constructor(message = 'Share value is locked and cannot be changed') {
    super(message, 409, 'SHARE_VALUE_LOCKED');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
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

  const pgErr = err as PgError;
  if (typeof pgErr?.code === 'string') {
    const mapped = PG_ERROR_MAP[pgErr.code];
    if (mapped) {
      return new AppError(mapped.message, mapped.status, mapped.code);
    }
  }

  return new AppError('An unexpected error occurred', 500, 'INTERNAL_ERROR');
}
