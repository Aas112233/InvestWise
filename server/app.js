import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { checkDbConnection } from './middleware/dbConnectionMiddleware.js';
import { getSecurityConfig } from './middleware/securityHeaders.js';
import { apiVersioning, API_VERSION, SUPPORTED_VERSIONS } from './middleware/apiVersioning.js';
import correlationId from './middleware/correlationId.js';

// Load backend environment variables from server/.env for local usage.
dotenv.config({ path: '.env' });

// Validate required environment variables at startup.
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
const missing = requiredEnvVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
 console.error(` FATAL: Missing required environment variables: ${missing.join(', ')}`);
 console.error('Please check your environment variables and ensure all required values are set.');
 process.exit(1);
}

// Enforce JWT secret strength in production.
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
 console.error(' FATAL: JWT_SECRET must be at least 32 characters in production');
 console.error('Generate a strong secret using: openssl rand -base64 64');
 process.exit(1);
}

const app = express();

// Trust Proxy for Vercel / Render / Heroku.
if (process.env.NODE_ENV === 'production') {
 app.set('trust proxy', 1);
}

const allowedOrigins = process.env.CORS_ORIGINS
 ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
 : ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
 origin(origin, callback) {
  if (!origin) return callback(null, true);

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
 maxAge: 86400
};

const { helmet, additional } = getSecurityConfig();
app.use(helmet);
app.use(additional);

app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(correlationId);
app.use(logger);

app.get('/', (req, res) => {
 res.json({
  name: 'InvestWise API',
  version: API_VERSION,
  supportedVersions: SUPPORTED_VERSIONS,
  status: 'running',
  documentation: '/api/docs',
  health: '/api/health'
 });
});

app.use('/api', apiVersioning);

import healthRoutes from './routes/healthRoutes.js';
app.use('/api', healthRoutes);

import authRoutes from './routes/authRoutes.js';
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

import backupRoutes from './routes/backupRoutes.js';
app.use('/api/backup', checkDbConnection, backupRoutes);
app.use('/api/v1/backup', checkDbConnection, backupRoutes);

import aiRoutes from './routes/aiRoutes.js';
app.use('/api/ai', apiLimiter, checkDbConnection, aiRoutes);
app.use('/api/v1/ai', apiLimiter, checkDbConnection, aiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
