import express from 'express';
import { checkDbHealth, getSql } from '../db/connection.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  let dbStatus = 'healthy';
  let httpStatus = 200;
  let dbPingMs = null;
  let dbInfo = {
    host: process.env.SUPABASE_URL || 'supabase',
    name: 'postgres',
  };

  try {
    const pingStart = Date.now();
    const healthy = await checkDbHealth();
    dbPingMs = Date.now() - pingStart;

    if (!healthy) {
      dbStatus = 'disconnected';
      httpStatus = 503;
    } else if (dbPingMs > 1000) {
      dbStatus = 'slow';
    }
  } catch (error) {
    dbStatus = 'unreachable';
    httpStatus = 503;
    console.error('Health check - DB ping failed:', error.message);
  }

  const health = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    status: dbStatus === 'healthy' ? 'OK' : 'DEGRADED',
    database: {
      engine: 'postgresql',
      status: dbStatus,
      pingMs: dbPingMs,
      ...dbInfo,
    },
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
    },
    environment: process.env.NODE_ENV || 'development',
  };

  res.status(httpStatus).json(health);
});

router.get('/ping', (req, res) => {
  res.status(200).json({
    message: 'pong',
    timestamp: Date.now(),
  });
});

// Detailed database status endpoint
router.get('/db/status', async (req, res) => {
  try {
    const sql = getSql();
    const [version] = await sql`SELECT version()`;
    const [size] = await sql`
      SELECT
        pg_database_size(current_database()) AS db_size,
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS table_count
    `;

    res.json({
      engine: 'postgresql',
      version: version?.version || 'unknown',
      dbSize: size?.db_size ? Math.round(size.db_size / 1024 / 1024) + ' MB' : 'unknown',
      tableCount: size?.table_count || 0,
      host: process.env.SUPABASE_URL || 'supabase',
    });
  } catch (error) {
    res.status(503).json({
      engine: 'postgresql',
      status: 'unreachable',
      error: error.message,
    });
  }
});

export default router;
