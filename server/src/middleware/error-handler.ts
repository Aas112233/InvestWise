import type { Request, Response, NextFunction } from "express";
import { AppError } from "../shared/errors.js";

// PostgreSQL error codes -> human-readable messages
const PG_ERROR_MAP: Record<string, { status: number; message: string; code: string }> = {
  "23505": { status: 409, message: "A record with that value already exists (duplicate key).", code: "DUPLICATE_KEY" },
  "23503": { status: 409, message: "This action would violate a database relationship constraint.", code: "FK_VIOLATION" },
  "23502": { status: 400, message: "A required field is missing (not-null violation).", code: "NOT_NULL_VIOLATION" },
  "23514": { status: 400, message: "The value provided does not meet the required constraints.", code: "CHECK_VIOLATION" },
  "42703": { status: 500, message: "Database schema mismatch: a required column is missing. Run migrations.", code: "SCHEMA_MISMATCH" },
  "42P01": { status: 500, message: "Database schema mismatch: a required table is missing. Run migrations.", code: "SCHEMA_MISMATCH" },
  "08006": { status: 503, message: "Database connection lost. Please try again.", code: "DB_CONNECTION_ERROR" },
  "08001": { status: 503, message: "Unable to connect to the database.", code: "DB_CONNECTION_ERROR" },
  "57014": { status: 504, message: "Database query timed out. Please try again.", code: "QUERY_TIMEOUT" },
  "40001": { status: 503, message: "Database transaction conflict. Please retry.", code: "TRANSACTION_CONFLICT" },
  "40P01": { status: 503, message: "Deadlock detected. Please retry.", code: "DEADLOCK" },
  "22001": { status: 400, message: "A field value is too long for its column.", code: "STRING_TOO_LONG" },
  "22003": { status: 400, message: "A numeric value is out of range.", code: "NUMERIC_OVERFLOW" },
};

interface PgError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
  column?: string;
  table?: string;
  constraint?: string;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const pgErr = err as PgError;
  const isPgError = typeof pgErr.code === "string" && /^[0-9A-Z]{5}$/.test(pgErr.code);

  let statusCode: number;
  let clientMessage: string;
  let errorCode: string;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    clientMessage = statusCode >= 500 ? "An unexpected error occurred" : err.message;
    errorCode = err.code;
  } else if (isPgError && pgErr.code && PG_ERROR_MAP[pgErr.code]) {
    const mapped = PG_ERROR_MAP[pgErr.code];
    statusCode = mapped.status;
    clientMessage = mapped.message;
    errorCode = mapped.code;
    if (mapped.code === "SCHEMA_MISMATCH") {
      console.error(
        `[SCHEMA_MISMATCH] pg_code=${pgErr.code} table=${pgErr.table ?? "?"} detail=${pgErr.detail ?? "?"}`
      );
    }
  } else {
    statusCode = 500;
    clientMessage = "An unexpected error occurred";
    errorCode = "INTERNAL_ERROR";
  }

  const logPayload: Record<string, unknown> = {
    method: req.method,
    url: req.url,
    statusCode,
    errorName: err.name,
    errorMessage: err.message,
    correlationId: (req as any).correlationId,
  };

  if (err instanceof AppError) {
    logPayload.errorCode = err.code;
    if (err.details) logPayload.details = err.details;
  }

  if (isPgError && pgErr.code) {
    logPayload.pgCode = pgErr.code;
    if (pgErr.detail) logPayload.pgDetail = pgErr.detail;
    if (pgErr.constraint) logPayload.pgConstraint = pgErr.constraint;
    if (pgErr.table) logPayload.pgTable = pgErr.table;
  }

  if (statusCode >= 500) {
    console.error("[ERROR]", JSON.stringify(logPayload), "\n", err.stack?.split("\n").slice(0, 8).join("\n"));
  } else {
    console.warn("[WARN]", logPayload);
  }

  res.status(statusCode).json({
    success: false,
    message: clientMessage,
    code: errorCode,
    errorId: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    path: req.path,
    ...(process.env.NODE_ENV !== "production" && {
      _debug: {
        errorName: err.name,
        errorMessage: err.message,
        ...(isPgError && pgErr.code ? { pgCode: pgErr.code, pgDetail: pgErr.detail, pgConstraint: pgErr.constraint } : {}),
        errorStack: err.stack?.split("\n").slice(0, 5),
      },
    }),
  });
}

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  const err = new AppError(`Not Found - ${req.originalUrl}`, 404, "NOT_FOUND");
  next(err);
}
