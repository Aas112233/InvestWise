import mongoose from 'mongoose';

// Middleware to check database connection before processing requests
const checkDbConnection = (req, res, next) => {
  const dbState = mongoose.connection.readyState;
  
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (dbState === 0 || dbState === 3) {
    console.warn(` Request blocked - Database disconnected: ${req.method} ${req.url}`);
    
    return res.status(503).json({
      success: false,
      message: 'Database connection unavailable. Please try again in a few moments.',
      error: 'SERVICE_UNAVAILABLE',
      retryAfter: 5 // Suggest client to retry after 5 seconds
    });
  }
  
  if (dbState === 2) {
    console.warn(` Request delayed - Database connecting: ${req.method} ${req.url}`);
    
    return res.status(503).json({
      success: false,
      message: 'Database connection in progress. Please try again shortly.',
      error: 'SERVICE_UNAVAILABLE',
      retryAfter: 3
    });
  }
  
  // Connection is healthy (readyState === 1)
  next();
};

// Async middleware to verify database connectivity with actual ping
const verifyDbConnectivity = async (req, res, next) => {
  try {
    // Quick ping to verify database is actually responsive
    await mongoose.connection.db.admin().ping({ maxTimeMS: 2000 });
    next();
  } catch (error) {
    console.error(' Database ping failed:', error.message);
    
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
  
  // Log connection state at start of request
  const dbState = mongoose.connection.readyState;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  console.log(` DB State: ${stateMap[dbState]} | ${req.method} ${req.url}`);
  
  // Listen for disconnect during request
  const disconnectHandler = () => {
    console.warn(` Database disconnected during request: ${req.method} ${req.url}`);
  };
  
  mongoose.connection.once('disconnected', disconnectHandler);
  
  // Clean up listener after response
  res.on('finish', () => {
    mongoose.connection.removeListener('disconnected', disconnectHandler);
  });
  
  next();
};

export { checkDbConnection, verifyDbConnectivity, logDbState };
