import { checkDbHealth } from '../db/connection.js';

// Helper to wait for DB connection
const waitForDb = async (retries = 10, delay = 500) => {
  for (let i = 0; i < retries; i++) {
    const healthy = await checkDbHealth();
    if (healthy) return true;
    console.log(`[DB] Waiting for connection... (${i + 1}/${retries})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return false;
};

// Middleware to check database connection before processing requests
const checkDbConnection = async (req, res, next) => {
  try {
    const healthy = await checkDbHealth();
    if (!healthy) {
      const connected = await waitForDb();
      if (!connected) {
        return res.status(503).json({
          success: false,
          error: 'SERVICE_UNAVAILABLE',
          message: 'Database is connecting. Please try again in a moment.',
          retryAfter: 5
        });
      }
    }
    next();
  } catch (error) {
    return res.status(503).json({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database connection timeout. Please try again.',
      retryAfter: 5
    });
  }
};

// Async middleware to verify database connectivity with actual ping
const verifyDbConnectivity = async (req, res, next) => {
  try {
    const healthy = await checkDbHealth();
    if (!healthy) {
      return res.status(503).json({
        success: false,
        message: 'Database is not responding. Our team has been notified.',
        error: 'DATABASE_UNREACHABLE',
        retryAfter: 10
      });
    }
    next();
  } catch (error) {
    console.error('Database ping failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Database is not responding. Our team has been notified.',
      error: 'DATABASE_UNREACHABLE',
      retryAfter: 10
    });
  }
};

// Optional middleware - only logs connection state, doesn't block
const logDbState = (req, res, next) => {
  const start = Date.now();
  console.log(`DB State check | ${req.method} ${req.url}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`Slow request: ${req.method} ${req.url} took ${duration}ms`);
    }
  });

  next();
};

export { checkDbConnection, verifyDbConnectivity, logDbState };
