import { Request, Response, NextFunction } from 'express';
import { checkDbHealth, sql } from '../db/connection.js';

// Helper to wait for DB connection
const waitForDb = async (retries = 10, delay = 500): Promise<boolean> => {
  for (let i = 0; i < retries; i++) {
    const healthy = await checkDbHealth();
    if (healthy) {
      return true;
    }
    console.log(`[DB] Waiting for connection... (${i + 1}/${retries})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return false;
};

// Middleware to check database connection before processing requests
const checkDbConnection = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const healthy = await checkDbHealth();

  if (!healthy) {
    try {
      const connected = await waitForDb();
      if (!connected) {
        res.status(503).json({
          success: false,
          error: 'SERVICE_UNAVAILABLE',
          message: 'Database is connecting. Please try again in a moment.',
          retryAfter: 5
        });
        return;
      }
    } catch (error) {
      res.status(503).json({
        success: false,
        error: 'SERVICE_UNAVAILABLE',
        message: 'Database connection timeout. Please try again.',
        retryAfter: 5
      });
      return;
    }
  }

  // Connection is healthy
  next();
};

// Async middleware to verify database connectivity with actual health check
const verifyDbConnectivity = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const healthy = await checkDbHealth();
    if (!healthy) {
      throw new Error('Health check returned false');
    }
    next();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown database error';
    console.error('Database ping failed:', message);

    res.status(503).json({
      success: false,
      message: 'Database is not responding. Our team has been notified.',
      error: 'DATABASE_UNREACHABLE',
      retryAfter: 10
    });
  }
};

// Optional middleware - only logs connection state, doesn't block
const logDbState = (req: Request, res: Response, next: NextFunction): void => {
  // Non-blocking health check for logging purposes
  checkDbHealth()
    .then(healthy => {
      const stateStr = healthy ? 'connected' : 'disconnected';
      console.log(`DB State: ${stateStr} | ${req.method} ${req.url}`);
    })
    .catch(() => {
      console.log(`DB State: unknown | ${req.method} ${req.url}`);
    });

  // Listen for connection errors during request
  const errorHandler = (err: Error): void => {
    console.warn(
      `Database connection error during request: ${req.method} ${req.url}`,
      err.message
    );
  };

  sql.on('error', errorHandler);

  // Clean up listener after response
  res.on('finish', () => {
    sql.off('error', errorHandler);
  });

  next();
};

export { checkDbConnection, verifyDbConnectivity, logDbState };
