/**
 * Shared Backup Utilities
 * Used by both CLI scripts and Vercel API routes
 */
import mongoose from 'mongoose';
import zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import r2Storage from '../../utils/cloudflareR2.js';

const gzip = promisify(zlib.gzip);

// Import models - handle missing models gracefully
let Member, Transaction, Project, Fund, User, SystemSettings, AuditLog;

try {
    Member = (await import('../../models/Member.js')).default;
    Transaction = (await import('../../models/Transaction.js')).default;
    Project = (await import('../../models/Project.js')).default;
    Fund = (await import('../../models/Fund.js')).default;
    User = (await import('../../models/User.js')).default;
    SystemSettings = (await import('../../models/SystemSettings.js')).default;
    AuditLog = (await import('../../models/AuditLog.js')).default;
} catch (error) {
    console.warn('⚠️  Some models not found, backup will be partial');
}

// Critical collections to backup
const BACKUP_COLLECTIONS = [
    { name: 'members', model: Member, priority: 'critical' },
    { name: 'transactions', model: Transaction, priority: 'critical' },
    { name: 'projects', model: Project, priority: 'critical' },
    { name: 'funds', model: Fund, priority: 'critical' },
    { name: 'users', model: User, priority: 'important' },
    { name: 'systemSettings', model: SystemSettings, priority: 'important' },
    { name: 'auditLogs', model: AuditLog, priority: 'optional' },
].filter(c => c.model); // Only include available models

/**
 * Main backup logic (reusable)
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

        // Connect to MongoDB
        await connectToDatabase();

        // Export data
        const backupData = await exportBackupData();
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

        // Success
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
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
        }
    }
}

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoURI) {
        throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
    }

    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    await mongoose.connect(mongoURI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB');
    return mongoose.connection;
}

/**
 * Export all collections
 */
async function exportBackupData() {
    console.log('📦 Exporting data...');
    
    const backup = {
        metadata: {
            version: '1.0',
            timestamp: new Date().toISOString(),
            database: mongoose.connection.name,
            host: mongoose.connection.host,
        },
        collections: {},
        statistics: {
            totalCollections: 0,
            totalDocuments: 0,
        },
    };

    for (const collection of BACKUP_COLLECTIONS) {
        try {
            const documents = await collection.model.find({}).lean();
            
            backup.collections[collection.name] = {
                name: collection.name,
                count: documents.length,
                data: documents,
                exportedAt: new Date().toISOString(),
            };
            
            backup.statistics.totalCollections++;
            backup.statistics.totalDocuments += documents.length;
            
            console.log(`  ✅ ${collection.name}: ${documents.length} documents`);
        } catch (error) {
            console.error(`  ❌ ${collection.name}: ${error.message}`);
        }
    }

    console.log(`📊 Total: ${backup.statistics.totalCollections} collections, ${backup.statistics.totalDocuments} documents`);
    
    return backup;
}

/**
 * Compress backup data
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
 * Upload to R2
 */
async function uploadToR2(compressedBackup, type) {
    console.log(`☁️  Uploading to R2 (${type})...`);
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `backup-${timestamp}.json.gz`;
    const key = `${type}/${filename}`;
    
    const metadata = {
        'backup-type': type,
        'backup-date': timestamp,
        'backup-version': '1.0',
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
 * Update latest backup pointer
 */
async function updateLatestPointer(uploadResult) {
    const latestKey = 'latest/backup-latest.json.gz';
    
    await r2Storage.upload(latestKey, Buffer.from(JSON.stringify({
        pointsTo: uploadResult.key,
        lastBackup: uploadResult.filename,
        timestamp: new Date().toISOString(),
    })), {
        'points-to': uploadResult.key,
    });
    
    console.log('📍 Latest pointer updated');
}
