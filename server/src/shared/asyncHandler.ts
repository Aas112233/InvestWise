import type { Request, Response, NextFunction } from 'express';
import type { AsyncHandler } from '../shared/types.js';

/**
 * Wraps an async route handler to catch errors and forward them to Express error handler.
 * Replaces express-async-handler dependency.
 */
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
