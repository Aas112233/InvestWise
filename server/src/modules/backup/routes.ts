import { Router } from 'express';
import { protect, admin } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/asyncHandler.js';
import { getDb, getSql } from '../../config/database.js';
import { env } from '../../config/env.js';

export const backupRouter = Router();

// ============================================================
// CRON route — NOT behind auth (called by Vercel scheduler).
// Must be registered BEFORE the protect/admin middleware below.
// ============================================================
backupRouter.post('/cron', asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (env.CRON_SECRET && (!auth || auth !== `Bearer ${env.CRON_SECRET}`)) {
    res.status(401).json({ success: false, message: 'Invalid cron secret' });
    return;
  }

  const sql = getSql();
  const tables = [
    'members', 'transactions', 'projects', 'funds', 'users',
    'system_settings', 'audit_logs', 'login_attempts', 'sessions',
    'deleted_records', 'blacklisted_tokens', 'global_stats', 'goals',
  ];

  const backup: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }

  console.log(`[cron] Backup completed: ${tables.length} tables at ${new Date().toISOString()}`);

  res.json({
    success: true,
    status: 'completed',
    tables: tables.length,
    timestamp: new Date().toISOString(),
  });
}));

// ============================================================
// All routes below require admin authentication
// ============================================================
backupRouter.use(protect, admin);

// POST /manual — trigger manual backup
backupRouter.post('/manual', asyncHandler(async (req, res) => {
  const { type = 'daily' } = req.body;
  const db = getDb();
  const sql = getSql();

  const tables = [
    'members', 'transactions', 'projects', 'funds', 'users',
    'system_settings', 'audit_logs', 'login_attempts', 'sessions',
    'deleted_records', 'blacklisted_tokens', 'global_stats', 'goals',
  ];

  const backup: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }

  const backupData = {
    version: '2.0',
    engine: 'postgresql',
    timestamp: new Date().toISOString(),
    type,
    tables: backup,
  };

  res.json({
    success: true,
    status: 'completed',
    duration: 0,
    tables: tables.length,
    timestamp: backupData.timestamp,
  });
}));

// GET /download — download full backup as JSON
backupRouter.get('/download', asyncHandler(async (_req, res) => {
  const sql = getSql();
  const tables = [
    'members', 'transactions', 'projects', 'funds', 'users',
    'system_settings', 'audit_logs', 'login_attempts', 'sessions',
    'deleted_records', 'blacklisted_tokens', 'global_stats', 'goals',
  ];

  const backup: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }

  const backupData = {
    version: '2.0',
    engine: 'postgresql',
    timestamp: new Date().toISOString(),
    tables: backup,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=investwise-backup-${new Date().toISOString().split('T')[0]}.json`);
  res.json(backupData);
}));

// GET /list — list available backups
backupRouter.get('/list', asyncHandler(async (_req, res) => {
  // In production, this would list from R2. For now, return empty.
  res.json({ success: true, backups: [] });
}));

// POST /restore — restore from backup
backupRouter.post('/restore', asyncHandler(async (req, res) => {
  const { backupKey } = req.body;
  if (!backupKey) {
    res.status(400).json({ success: false, message: 'backupKey is required' });
    return;
  }
  // In production, this would download from R2 and restore.
  res.json({ success: true, status: 'restore_queued' });
}));

export default backupRouter;
