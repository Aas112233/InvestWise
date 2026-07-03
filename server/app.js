import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';
import { apiLimiter, authLimiter } from './middleware/rateLimiter.js';
import { checkDbConnection } from './middleware/dbConnectionMiddleware.js';
import rlsContext from './middleware/rlsContextMiddleware.js';
import { getSecurityConfig } from './middleware/securityHeaders.js';
import { apiVersioning, API_VERSION, SUPPORTED_VERSIONS } from './middleware/apiVersioning.js';
import correlationId from './middleware/correlationId.js';

// Load backend environment variables from server/.env for local usage.
dotenv.config({ path: '.env' });

// Validate required environment variables at startup.
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
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
import authRoutes from './routes/authRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import fundRoutes from './routes/fundRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import goalRoutes from './routes/goalRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import backupRoutes from './routes/backupRoutes.js';
import aiRoutes from './routes/aiRoutes.js';

const apiRouter = express.Router();

// Health check doesn't need DB check or strict rate limits
apiRouter.use('/', healthRoutes);

// Apply common middleware to all API routes
apiRouter.use(apiLimiter);
apiRouter.use(checkDbConnection);
apiRouter.use(rlsContext);

// Register domain routes
apiRouter.use('/auth', authRoutes);
apiRouter.use('/members', memberRoutes);
apiRouter.use('/projects', projectRoutes);
apiRouter.use('/funds', fundRoutes);
apiRouter.use('/finance', financeRoutes);
apiRouter.use('/reports', reportRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/goals', goalRoutes);
apiRouter.use('/audit', auditRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/backup', backupRoutes);
apiRouter.use('/ai', aiRoutes);

// Mount the consolidated router at both paths for backward compatibility,
// but with versioning middleware determining the actual active version
app.use('/api/v1', apiVersioning, apiRouter);
app.use('/api', apiVersioning, apiRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
