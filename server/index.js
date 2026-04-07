import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import app from './app.js';

// Load backend environment variables from server/.env
dotenv.config({ path: '.env' });

// Validate required environment variables at startup
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'PORT'];
const missing = requiredEnvVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
    console.error(` FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

// Enforce JWT secret strength in production
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
    console.error(' FATAL: JWT_SECRET must be at least 32 characters in production');
    console.error('Generate a strong secret using: openssl rand -base64 64');
    process.exit(1);
}

console.log(' Environment variables validated successfully');
const PORT = process.env.PORT || 5000;

// CRITICAL: Wait for MongoDB connection before processing requests (prevents 503 on cold starts)
const waitForDb = async (retries = 10, delay = 500) => {
    for (let i = 0; i < retries; i++) {
        if (mongoose.connection.readyState === 1) {
            return true;
        }
        console.log(`[DB] Waiting for connection... (${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return false;
};

// Add middleware to wait for DB before processing requests (prevents 503 errors)
app.use(async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        try {
            const connected = await waitForDb();
            if (!connected) {
                return res.status(503).json({
                    error: 'SERVICE_UNAVAILABLE',
                    message: 'Database is connecting. Please try again in a moment.',
                    retryAfter: 5
                });
            }
            next();
        } catch (error) {
            return res.status(503).json({
                error: 'SERVICE_UNAVAILABLE',
                message: 'Database connection timeout. Please try again.',
                retryAfter: 5
            });
        }
    } else {
        next();
    }
});

const startServer = async () => {
    try {
        // Try to connect to DB, but don't fail completely if it doesn't work
        await connectDB();
        console.log(' Database connection established');
    } catch (error) {
        console.warn(' Failed to connect to database. Server will start but API calls may fail.');
        console.warn(' The database connection will be retried automatically.');
    }

    app.listen(PORT, () => {
        console.log(` Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        console.log(` Health check: http://localhost:${PORT}/api/health`);
    });
};

startServer();
