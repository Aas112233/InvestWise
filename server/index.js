import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import connectDB from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { checkDbConnection } from './middleware/dbConnectionMiddleware.js';
import { getSecurityConfig } from './middleware/securityHeaders.js';
import { apiVersioning, API_VERSION, SUPPORTED_VERSIONS } from './middleware/apiVersioning.js';

// Load backend environment variables from server/.env
dotenv.config({ path: '.env' });



const app = express();

// Trust Proxy for Render/Heroku (required for correctly logging IP and rate limiting)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Production CORS Configuration
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);

        // Allow any localhost origin for development (Flutter web, etc.)
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || origin.startsWith('http://localhost')) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Version'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-API-Version', 'X-Supported-Versions'],
    maxAge: 86400 // 24 hours
};

// Apply Security Headers (CSP, HSTS, X-Frame-Options, etc.)
const { helmet, additional } = getSecurityConfig();
app.use(helmet);
app.use(additional);

app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(logger);

// API Versioning Info
app.get('/', (req, res) => {
    res.json({
        name: 'InvestWise API',
        version: API_VERSION,
        supportedVersions: SUPPORTED_VERSIONS,
        status: 'running',
        documentation: '/api/docs',
        health: '/api/health',
    });
});

// Apply API versioning to all /api routes
app.use('/api', apiVersioning);

import healthRoutes from './routes/healthRoutes.js';
app.use('/api', healthRoutes);

import authRoutes from './routes/authRoutes.js';

// Apply DB connection check to all API routes (except health check)
// Routes work with both /api/v1/... and /api/... (default version)
app.use('/api/auth', apiLimiter, checkDbConnection, authRoutes);
app.use('/api/v1/auth', apiLimiter, checkDbConnection, authRoutes);

import memberRoutes from './routes/memberRoutes.js';
app.use('/api/members', apiLimiter, checkDbConnection, memberRoutes);
app.use('/api/v1/members', apiLimiter, checkDbConnection, memberRoutes);

import projectRoutes from './routes/projectRoutes.js';
import fundRoutes from './routes/fundRoutes.js';

app.use('/api/projects', apiLimiter, checkDbConnection, projectRoutes);
app.use('/api/v1/projects', apiLimiter, checkDbConnection, projectRoutes);

app.use('/api/funds', apiLimiter, checkDbConnection, fundRoutes);
app.use('/api/v1/funds', apiLimiter, checkDbConnection, fundRoutes);

import financeRoutes from './routes/financeRoutes.js';
app.use('/api/finance', apiLimiter, checkDbConnection, financeRoutes);
app.use('/api/v1/finance', apiLimiter, checkDbConnection, financeRoutes);

import reportRoutes from './routes/reportRoutes.js';
app.use('/api/reports', apiLimiter, checkDbConnection, reportRoutes);
app.use('/api/v1/reports', apiLimiter, checkDbConnection, reportRoutes);

import analyticsRoutes from './routes/analyticsRoutes.js';
app.use('/api/analytics', apiLimiter, checkDbConnection, analyticsRoutes);
app.use('/api/v1/analytics', apiLimiter, checkDbConnection, analyticsRoutes);

import goalRoutes from './routes/goalRoutes.js';
app.use('/api/goals', apiLimiter, checkDbConnection, goalRoutes);
app.use('/api/v1/goals', apiLimiter, checkDbConnection, goalRoutes);

import auditRoutes from './routes/auditRoutes.js';
app.use('/api/audit', apiLimiter, checkDbConnection, auditRoutes);
app.use('/api/v1/audit', apiLimiter, checkDbConnection, auditRoutes);

import settingsRoutes from './routes/settingsRoutes.js';
app.use('/api/settings', apiLimiter, checkDbConnection, settingsRoutes);
app.use('/api/v1/settings', apiLimiter, checkDbConnection, settingsRoutes);

// AI Routes (must be after other routes to avoid conflicts)
import aiRoutes from './routes/aiRoutes.js';
app.use('/api/ai', apiLimiter, checkDbConnection, aiRoutes);
app.use('/api/v1/ai', apiLimiter, checkDbConnection, aiRoutes);

// Error Handling
app.use(notFound);
app.use(errorHandler);


const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        // Try to connect to DB, but don't fail completely if it doesn't work
        await connectDB();
        console.log('✅ Database connection established');
    } catch (error) {
        console.warn('⚠️  Failed to connect to database. Server will start but API calls may fail.');
        console.warn('⚠️  The database connection will be retried automatically.');
    }

    app.listen(PORT, () => {
        console.log(`✅ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    });
};

startServer();
