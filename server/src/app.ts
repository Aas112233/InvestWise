import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { checkDbHealth } from './config/database.js';
import { cache } from './lib/cache.js';

const app = express();

// Trust first proxy hop in production (Vercel, Render, Cloudflare, Nginx)
app.set('trust proxy', isProduction ? 1 : false);

// Security & Content Security Policy (CSP)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:", "http://localhost:*", "ws://localhost:*"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Cookie Parser for HttpOnly JWT authentication
app.use(cookieParser());

// CORS
const allowedOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

const allowedOriginSet = new Set(allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, same-origin)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Exact match
    if (allowedOriginSet.has(origin)) {
      callback(null, true);
      return;
    }
    // Allow any Vercel preview deployment (.vercel.app)
    if (origin.endsWith('.vercel.app')) {
      callback(null, true);
      return;
    }
    // Allow localhost on any port (development)
    if (/^https?:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Version'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-API-Version', 'X-Supported-Versions'],
  maxAge: 86400,
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID
app.use((req, _res, next) => {
  req.correlationId = crypto.randomUUID();
  next();
});

// Request Logging Middleware
app.use((req, res, next) => {
  if (req.path === '/api/health' || req.path === '/api/ping') return next();
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// RLS context reset — DISABLED for Supabase transaction-mode pooler (port 6543).
// In transaction mode, each statement goes to a random connection from the pool,
// so session-level settings (set_config) are lost immediately. The reset was pure
// overhead (~300ms per request to Tokyo) with no actual RLS enforcement.
// Re-enable when switching to session-mode pooler (port 5432).

// Rate limiting
app.use('/api', apiLimiter);

// Health check (no auth) — result is cached for 10 s to avoid a DB round-trip
// on every frontend poll. The cache is bypassed only on a cold start.
const HEALTH_CACHE_KEY = 'health:db';
const HEALTH_CACHE_TTL = 10_000; // 10 seconds

app.get('/api/health', async (_req, res) => {
  const dbHealthy = await cache.getOrSet(
    HEALTH_CACHE_KEY,
    () => checkDbHealth(),
    HEALTH_CACHE_TTL,
  );
  res.json({
    status: dbHealthy ? 'healthy' : 'degraded',
    database: dbHealthy ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

app.get('/api/ping', (_req, res) => {
  res.json({ message: 'pong', timestamp: new Date().toISOString() });
});

// Route imports
import authRouter from './modules/auth/routes.js';
import memberRouter from './modules/members/routes.js';
import { fundRouter } from './modules/funds/routes.js';
import { goalRouter } from './modules/goals/routes.js';
import financeRouter from './modules/finance/routes.js';
import projectRouter from './modules/projects/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import backupRouter from './modules/backup/routes.js';
import { arrearsRouter } from './modules/arrears/routes.js';
import { fiscalRouter } from './modules/fiscal/routes.js';
import { aiRouter } from './modules/ai/routes.js';
import { meetingsRouter } from './modules/meetings/routes.js';
import { governanceRouter } from './modules/governance/routes.js';

// API routes
app.use('/api/auth', authRouter);
app.use('/api/members', memberRouter);
app.use('/api/funds', fundRouter);
app.use('/api/goals', goalRouter);
app.use('/api/finance', financeRouter);
app.use('/api/projects', projectRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/arrears', arrearsRouter);
app.use('/api/fiscal', fiscalRouter);
app.use('/api/ai', aiRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/governance', governanceRouter);

// 404 + error handler (must be last)
app.use(notFound);
app.use(errorHandler);

export default app;
