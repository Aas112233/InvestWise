/**
 * Shared Backup Utilities — PostgreSQL / Drizzle ORM
 * Used by both CLI scripts and Vercel API routes
 */
import zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import connectDB from '../../db/connection.js';
import r2Storage from '../../utils/cloudflareR2.js';

const gzip = promisify(zlib.gzip);

// Drizzle table references — lazy-loaded after DB connection
let tables = {};

async function loadTables() {
  if (Object.keys(tables).length > 0) return tables;
  const schema = await import('../../db/schema/index.js');
  tables = {
    members: schema.members,
    transactions: schema.transactions,
    projects: schema.projects,
    funds: schema.funds,
    users: schema.users,
    systemSettings: schema.systemSettings,
    auditLogs: schema.auditLogs,
    goals: schema.goals,
    sessions: schema.sessions,
    loginAttempts: schema.loginAttempts,
    blacklistedTokens: schema.blacklistedTokens,
    deletedRecords: schema.deletedRecords,
    globalStats: schema.globalStats,
  };
  return tables;
}

// Critical tables to backup (ordered by priority)
const BACKUP_TABLES = [
  { name: 'members', priority: 'critical' },
  { name: 'transactions', priority: 'critical' },
  { name: 'projects', priority: 'critical' },
  { name: 'funds', priority: 'critical' },
  { name: 'users', priority: 'important' },
  { name: 'system_settings', priority: 'important' },
  { name: 'goals', priority: 'important' },
  { name: 'sessions', priority: 'optional' },
  { name: 'audit_logs', priority: 'optional' },
  { name: 'login_attempts', priority: 'optional' },
  { name: 'blacklisted_tokens', priority: 'optional' },
  { name: 'deleted_records', priority: 'optional' },
  { name: 'global_stats', priority: 'optional' },
];

/**
 * Main backup logic (reusable across cron, manual, and CLI triggers)
 */
export async function runBackupLogic(type = 'daily') {
  const startTime = Date.now();
  const backupLog = {
    timestamp: new Date().toISOString(),
    type,
    status: 'in_progress',
    stages: [],
  };

  try {
    console.log(`🚀 Starting ${type} backup...`);

    // Connect to PostgreSQL via Drizzle
    const db = await connectDB();
    await loadTables();

    // Export data
    const backupData = await exportBackupData(db);
    backupLog.statistics = backupData.statistics;

    // Compress
    const compressed = await compressBackup(backupData);
    backupLog.compression = {
      originalSize: compressed.originalSize,
      compressedSize: compressed.compressedSize,
      ratio: compressed.compressionRatio,
    };

    // Upload to R2
    const uploadResult = await uploadToR2(compressed, type);
    backupLog.upload = uploadResult;

    // Verify
    const isVerified = await r2Storage.verify(uploadResult.key, uploadResult.checksum);
    if (!isVerified) {
      throw new Error('Backup verification failed');
    }

    // Update latest pointer
    await updateLatestPointer(uploadResult);

    // Cleanup old backups
    if (type === 'daily') {
      const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
      await r2Storage.cleanOldBackups('daily/', retentionDays);
    }

    backupLog.status = 'success';
    backupLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Backup completed in ${backupLog.duration}s`);

    return backupLog;

  } catch (error) {
    backupLog.status = 'failed';
    backupLog.error = error.message;
    backupLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('❌ Backup failed:', error.message);
    return backupLog;
  }
  // No manual disconnect needed — connection pooling handles it
}

/**
 * Export all tables to JSON
 */
async function exportBackupData(db) {
  console.log('📦 Exporting data...');

  const backup = {
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
    try {
      const drizzleTable = tables[table.name];
      if (!drizzleTable) {
        console.warn(`  ⚠️  ${table.name}: no Drizzle table mapping`);
        continue;
      }

      const rows = await db.select().from(drizzleTable);

      backup.tables[table.name] = {
        name: table.name,
        count: rows.length,
        data: rows,
        exportedAt: new Date().toISOString(),
      };

      backup.statistics.totalTables++;
      backup.statistics.totalRows += rows.length;

      console.log(`  ✅ ${table.name}: ${rows.length} rows`);
    } catch (error) {
      console.error(`  ❌ ${table.name}: ${error.message}`);
    }
  }

  console.log(`📊 Total: ${backup.statistics.totalTables} tables, ${backup.statistics.totalRows} rows`);
  return backup;
}

/**
 * Compress backup data with gzip
 */
async function compressBackup(backupData) {
  console.log('🗜️  Compressing...');

  const jsonString = JSON.stringify(backupData, null, 2);
  const compressed = await gzip(jsonString);
  const checksum = createHash('md5').update(compressed).digest('base64');

  return {
    buffer: compressed,
    checksum,
    originalSize: Buffer.byteLength(jsonString),
    compressedSize: compressed.length,
    compressionRatio: ((1 - compressed.length / Buffer.byteLength(jsonString)) * 100).toFixed(2),
  };
}

/**
 * Upload compressed backup to Cloudflare R2
 */
async function uploadToR2(compressedBackup, type) {
  console.log(`☁️  Uploading to R2 (${type})...`);

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `backup-${timestamp}.json.gz`;
  const key = `${type}/${filename}`;

  const metadata = {
    'backup-type': type,
    'backup-date': timestamp,
    'backup-version': '2.0',
    'engine': 'postgresql',
  };

  const url = await r2Storage.upload(key, compressedBackup.buffer, metadata);

  return {
    key,
    filename,
    url,
    type,
    size: compressedBackup.compressedSize,
    checksum: compressedBackup.checksum,
  };
}

/**
 * Update latest backup pointer in R2
 */
async function updateLatestPointer(uploadResult) {
  const latestKey = 'latest/backup-latest.json.gz';

  await r2Storage.upload(latestKey, Buffer.from(JSON.stringify({
    pointsTo: uploadResult.key,
    lastBackup: uploadResult.filename,
    timestamp: new Date().toISOString(),
    engine: 'postgresql',
  })), {
    'points-to': uploadResult.key,
  });

  console.log('📍 Latest pointer updated');
}
