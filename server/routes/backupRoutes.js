/**
 * Backup API Routes (Express) — PostgreSQL / Drizzle ORM
 * Cloudflare R2 backup/restore endpoints
 */
import express from 'express';
import zlib from 'zlib';
import { promisify } from 'util';
import { protect, admin } from '../middleware/authMiddleware.js';
import r2Storage from '../utils/cloudflareR2.js';
import { getDb } from '../db/connection.js';

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

const router = express.Router();

const BACKUP_TABLES = [
  { name: 'members', schemaKey: 'members' },
  { name: 'transactions', schemaKey: 'transactions' },
  { name: 'projects', schemaKey: 'projects' },
  { name: 'funds', schemaKey: 'funds' },
  { name: 'users', schemaKey: 'users' },
  { name: 'system_settings', schemaKey: 'systemSettings' },
  { name: 'audit_logs', schemaKey: 'auditLogs' },
  { name: 'login_attempts', schemaKey: 'loginAttempts' },
  { name: 'sessions', schemaKey: 'sessions' },
  { name: 'deleted_records', schemaKey: 'deletedRecords' },
  { name: 'blacklisted_tokens', schemaKey: 'blacklistedTokens' },
  { name: 'global_stats', schemaKey: 'globalStats' },
  { name: 'goals', schemaKey: 'goals' },
];

async function getTable(schemaKey) {
  const schema = await import('../db/schema/index.js');
  return schema[schemaKey] || null;
}

/**
 * Manual Backup Trigger
 * POST /api/backup/manual
 */
router.post('/manual', protect, admin, async (req, res) => {
  try {
    const backupType = req.body.type || 'daily';
    const startTime = Date.now();
    const db = getDb();

    console.log(`🚀 Manual Backup Triggered: ${backupType}`);

    const backupData = {
      metadata: {
        version: '2.0',
        engine: 'postgresql',
        timestamp: new Date().toISOString(),
        database: process.env.SUPABASE_URL || 'postgresql',
      },
      tables: {},
      statistics: {
        totalTables: 0,
        totalRows: 0,
      },
    };

    for (const table of BACKUP_TABLES) {
      const drizzleTable = await getTable(table.schemaKey);
      if (!drizzleTable) continue;

      const rows = await db.select().from(drizzleTable);
      backupData.tables[table.name] = {
        name: table.name,
        count: rows.length,
        data: rows,
      };
      backupData.statistics.totalTables++;
      backupData.statistics.totalRows += rows.length;
    }

    // Compress
    const jsonString = JSON.stringify(backupData, null, 2);
    const compressed = await gzip(jsonString);

    // Upload to R2
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `backup-${timestamp}.json.gz`;
    const key = `${backupType}/${filename}`;

    await r2Storage.upload(key, compressed, {
      'backup-type': backupType,
      'backup-date': timestamp,
      'engine': 'postgresql',
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Backup completed in ${duration}s`);

    return res.status(200).json({
      status: 'success',
      type: backupType,
      duration,
      filename,
      key,
      tables: backupData.statistics.totalTables,
      rows: backupData.statistics.totalRows,
    });

  } catch (error) {
    console.error('Manual backup failed:', error);
    return res.status(500).json({
      status: 'failed',
      error: error.message,
    });
  }
});

/**
 * Download Backup Directly (JSON)
 * GET /api/backup/download
 */
router.get('/download', protect, admin, async (req, res) => {
  try {
    console.log(`📥 Direct Backup Download Triggered`);
    const db = getDb();

    const backupData = {
      metadata: {
        version: '2.0',
        engine: 'postgresql',
        timestamp: new Date().toISOString(),
        database: process.env.SUPABASE_URL || 'postgresql',
      },
      tables: {},
      statistics: {
        totalTables: 0,
        totalRows: 0,
      },
    };

    for (const table of BACKUP_TABLES) {
      const drizzleTable = await getTable(table.schemaKey);
      if (!drizzleTable) continue;

      const rows = await db.select().from(drizzleTable);
      backupData.tables[table.name] = {
        name: table.name,
        count: rows.length,
        data: rows,
      };
      backupData.statistics.totalTables++;
      backupData.statistics.totalRows += rows.length;
    }

    const jsonString = JSON.stringify(backupData, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${new Date().toISOString().split('T')[0]}.json"`);
    return res.status(200).send(jsonString);

  } catch (error) {
    console.error('Direct backup failed:', error);
    return res.status(500).json({
      status: 'failed',
      error: error.message,
    });
  }
});

/**
 * List All Backups
 * GET /api/backup/list
 */
router.get('/list', protect, admin, async (req, res) => {
  try {
    const { prefix = '' } = req.query;
    const backups = await r2Storage.listBackups(prefix);

    const formattedBackups = backups.map(backup => ({
      ...backup,
      sizeKB: (backup.size / 1024).toFixed(2),
      age: getAge(backup.lastModified),
    }));

    return res.status(200).json({
      success: true,
      count: formattedBackups.length,
      backups: formattedBackups,
    });

  } catch (error) {
    console.error('Failed to list backups:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Restore from Cloud Backup
 * POST /api/backup/restore
 */
router.post('/restore', protect, admin, async (req, res) => {
  try {
    const { backupKey, confirm } = req.body;

    if (!backupKey) {
      return res.status(400).json({ error: 'backupKey is required' });
    }

    if (!confirm) {
      return res.status(400).json({
        error: 'Restore requires confirmation. Set confirm: true',
        warning: 'This will overwrite existing data!',
      });
    }

    console.log(`☁️ Cloud Restore initiated: ${backupKey}`);

    // Download backup
    const backupBuffer = await r2Storage.download(backupKey);

    // Decompress
    const decompressed = await gunzip(backupBuffer);
    const backupData = JSON.parse(decompressed.toString());

    const db = getDb();
    const results = {};

    // Support both old "collections" (MongoDB) and new "tables" (PostgreSQL)
    const dataSource = backupData.tables || backupData.collections || {};

    for (const [name, tableData] of Object.entries(dataSource)) {
      try {
        // Map names to schema keys
        const entry = BACKUP_TABLES.find(t => t.name === name);
        if (!entry) {
          results[name] = { status: 'skipped', reason: 'No table mapping found' };
          continue;
        }

        const drizzleTable = await getTable(entry.schemaKey);
        if (!drizzleTable) {
          results[name] = { status: 'skipped', reason: 'Table not found' };
          continue;
        }

        // Clear existing data
        await db.delete(drizzleTable);

        // Insert backup data in batches
        const rows = tableData.data || [];
        if (rows.length > 0) {
          const BATCH_SIZE = 500;
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            await db.insert(drizzleTable).values(batch);
          }
        }

        results[name] = {
          status: 'success',
          rowsRestored: rows.length,
        };
      } catch (error) {
        results[name] = {
          status: 'failed',
          error: error.message,
        };
        // Continue restoring other tables
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Backup restored successfully',
      results,
    });

  } catch (error) {
    console.error('Failed to restore backup:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper: Format backup age
 */
function getAge(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
}

export default router;
