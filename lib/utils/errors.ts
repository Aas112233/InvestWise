export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message: string, code: string = 'UNAUTHORIZED') {
    super(message, 401, code);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class LockedError extends AppError {
  constructor(message: string) {
    super(message, 423, 'LOCKED');
    this.name = 'LockedError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Drizzle rethrows the driver (Postgres) error as a "Failed query: ..." wrapper
 * and parks the real SQLSTATE code + message on the nested `cause`, not the
 * thrown object. Callers that read `error.code` see `undefined` and lose the
 * reason. Walk the cause chain and return the first 5-character SQLSTATE.
 */
export function extractDbError(error: unknown): { code?: string; message?: string } {
  let cur: unknown = error;
  for (let depth = 0; cur && depth < 5; depth += 1) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, message: e.message };
    }
    cur = e.cause;
  }
  return { message: (error as { message?: string } | null)?.message };
}