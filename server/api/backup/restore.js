/**
 * Restore from Backup — PostgreSQL / Drizzle ORM
 * POST /api/backup/restore
 * Body: { backupKey: 'daily/backup-2026-07-03.json.gz', confirm: true }
 */
import zlib from 'zlib';
import { promisify } from 'util';
import connectDB from '../../db/connection.js';
import r2Storage from '../../utils/cloudflareR2.js';

const gunzip = promisify(zlib.gunzip);

export const config = {
  maxDuration: 600, // 10 minutes for large restores
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  console.log(`🔄 Restore initiated: ${backupKey}`);

  const startTime = Date.now();
  const restoreLog = {
    timestamp: new Date().toISOString(),
    backupKey,
    status: 'in_progress',
  };

  try {
    // Stage 1: Download backup
    console.log('Stage 1/4: Downloading backup...');
    const backupBuffer = await r2Storage.download(backupKey);
    restoreLog.stages = [{ name: 'download', status: 'success' }];

    // Stage 2: Decompress
    console.log('Stage 2/4: Decompressing...');
    const decompressed = await gunzip(backupBuffer);
    const backupData = JSON.parse(decompressed.toString());
    restoreLog.stages.push({ name: 'decompression', status: 'success' });

    // Stage 3: Connect to PostgreSQL
    console.log('Stage 3/4: Connecting to database...');
    const db = await connectDB();
    restoreLog.stages.push({ name: 'database_connection', status: 'success' });

    // Stage 4: Restore tables
    console.log('Stage 4/4: Restoring tables...');
    const restoreResults = await restoreTables(db, backupData);
    restoreLog.stages.push({ name: 'restore', status: 'success', results: restoreResults });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    restoreLog.status = 'success';
    restoreLog.duration = duration;

    console.log(`✅ Restore completed in ${duration}s`);
    return res.status(200).json(restoreLog);

  } catch (error) {
    restoreLog.status = 'failed';
    restoreLog.error = error.message;
    restoreLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('Restore failed:', error);
    return res.status(500).json(restoreLog);
  }
}

/**
 * Restore tables to PostgreSQL using Drizzle
 */
async function restoreTables(db, backupData) {
  const results = {};
  // Support both old "collections" key (MongoDB) and new "tables" key (PostgreSQL)
  const tables = backupData.tables || backupData.collections || {};

  for (const [tableName, tableData] of Object.entries(tables)) {
    console.log(`Restoring ${tableName}...`);

    try {
      // Dynamically load the Drizzle table
      const schema = await import('../../db/schema/index.js');
      // Map backup names to Drizzle schema keys
      const nameMap = {
        'members': 'members',
        'transactions': 'transactions',
        'projects': 'projects',
        'funds': 'funds',
        'users': 'users',
        'systemSettings': 'systemSettings',
        'system_settings': 'systemSettings',
        'goals': 'goals',
        'sessions': 'sessions',
        'auditLogs': 'auditLogs',
        'audit_logs': 'auditLogs',
        'loginAttempts': 'loginAttempts',
        'login_attempts': 'loginAttempts',
        'blacklistedTokens': 'blacklistedTokens',
        'blacklisted_tokens': 'blacklistedTokens',
        'deletedRecords': 'deletedRecords',
        'deleted_records': 'deletedRecords',
        'globalStats': 'globalStats',
        'global_stats': 'globalStats',
        'projectUpdates': 'projectUpdates',
        'project_updates': 'projectUpdates',
        'projectMembers': 'projectMembers',
        'project_members': 'projectMembers',
        'globalStatsTrends': 'globalStatsTrends',
        'global_stats_trends': 'globalStatsTrends',
        'globalStatsSectors': 'globalStatsSectors',
        'global_stats_sectors': 'globalStatsSectors',
      };

      const schemaKey = nameMap[tableName];
      if (!schemaKey || !schema[schemaKey]) {
        console.warn(`⚠️  No Drizzle mapping for ${tableName}`);
        results[tableName] = { status: 'skipped', reason: 'No table mapping found' };
        continue;
      }

      const drizzleTable = schema[schemaKey];

      // Clear existing data
      const deleted = await db.delete(drizzleTable).returning();
      console.log(`  Deleted ${deleted.length} existing rows`);

      // Insert backup data
      const rows = tableData.data || [];
      if (rows.length > 0) {
        // Insert in batches to avoid overwhelming the DB
        const BATCH_SIZE = 500;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          await db.insert(drizzleTable).values(batch);
        }
      }

      results[tableName] = {
        status: 'success',
        rowsRestored: rows.length,
      };

      console.log(`✅ Restored ${rows.length} rows to ${tableName}`);
    } catch (error) {
      console.error(`❌ Failed to restore ${tableName}:`, error.message);
      results[tableName] = {
        status: 'failed',
        error: error.message,
      };
    }
  }

  return results;
}
