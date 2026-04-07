/**
 * Core Backup Script
 * Exports MongoDB collections and uploads to Cloudflare R2
 */
import mongoose from 'mongoose';
import zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import r2Storage from '../utils/cloudflareR2.js';
import dotenv from 'dotenv';

dotenv.config();

const gzip = promisify(zlib.gzip);

// Import models
import Member from '../models/Member.js';
import Transaction from '../models/Transaction.js';
import Project from '../models/Project.js';
import Fund from '../models/Fund.js';
import User from '../models/User.js';
import SystemSettings from '../models/SystemSettings.js';
import AuditLog from '../models/AuditLog.js';

// Critical collections to backup
const BACKUP_COLLECTIONS = [
    { name: 'members', model: Member, priority: 'critical' },
    { name: 'transactions', model: Transaction, priority: 'critical' },
    { name: 'projects', model: Project, priority: 'critical' },
    { name: 'funds', model: Fund, priority: 'critical' },
    { name: 'users', model: User, priority: 'important' },
    { name: 'systemSettings', model: SystemSettings, priority: 'important' },
    { name: 'auditLogs', model: AuditLog, priority: 'optional' },
];

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoURI) {
        throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
    }

    console.log('🔌 Connecting to MongoDB...');
    
    await mongoose.connect(mongoURI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    });

    console.log('✅ Connected to MongoDB');
    return mongoose.connection;
}

/**
 * Export collection to JSON
 */
async function exportCollection(collectionConfig) {
    const { name, model } = collectionConfig;
    
    try {
        console.log(`📦 Exporting ${name}...`);
        
        const documents = await model.find({}).lean();
        
        console.log(`✅ Exported ${documents.length} documents from ${name}`);
        
        return {
            name,
            count: documents.length,
            data: documents,
            exportedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`❌ Failed to export ${name}:`, error.message);
        throw error;
    }
}

/**
 * Create backup data structure
 */
async function createBackupData() {
    console.log('📦 Starting backup export...\n');
    
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
        const exported = await exportCollection(collection);
        backup.collections[collection.name] = exported;
        backup.statistics.totalCollections++;
        backup.statistics.totalDocuments += exported.count;
    }

    console.log(`\n📊 Backup Statistics:`);
    console.log(`   Collections: ${backup.statistics.totalCollections}`);
    console.log(`   Total Documents: ${backup.statistics.totalDocuments}`);
    
    return backup;
}

/**
 * Compress backup data
 */
async function compressBackup(backupData) {
    console.log('\n🗜️  Compressing backup...');
    
    const jsonString = JSON.stringify(backupData, null, 2);
    const compressed = await gzip(jsonString);
    const checksum = createHash('md5').update(compressed).digest('base64');
    
    console.log(`✅ Backup compressed: ${(compressed.length / 1024).toFixed(2)} KB (checksum: ${checksum.substring(0, 16)}...)`);
    
    return {
        buffer: compressed,
        checksum,
        originalSize: Buffer.byteLength(jsonString),
        compressedSize: compressed.length,
        compressionRatio: ((1 - compressed.length / Buffer.byteLength(jsonString)) * 100).toFixed(2),
    };
}

/**
 * Upload backup to R2
 */
async function uploadBackup(compressedBackup, type = 'daily') {
    console.log(`\n☁️  Uploading backup to Cloudflare R2 (${type})...`);
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `backup-${timestamp}.json.gz`;
    const key = `${type}/${filename}`;
    
    const metadata = {
        'backup-type': type,
        'backup-date': timestamp,
        'backup-version': '1.0',
    };
    
    const uploadUrl = await r2Storage.upload(key, compressedBackup.buffer, metadata);
    
    console.log(`✅ Backup uploaded to: ${key}`);
    console.log(`   URL: ${uploadUrl}`);
    
    return {
        key,
        filename,
        url: uploadUrl,
        type,
        size: compressedBackup.compressedSize,
        checksum: compressedBackup.checksum,
    };
}

/**
 * Update latest backup pointer
 */
async function updateLatestPointer(uploadResult) {
    console.log('\n📍 Updating latest backup pointer...');
    
    // Upload a copy to latest/ folder
    const latestKey = 'latest/backup-latest.json.gz';
    
    await r2Storage.upload(latestKey, Buffer.alloc(0), {
        'points-to': uploadResult.key,
        'last-backup-date': uploadResult.filename.replace('backup-', '').replace('.json.gz', ''),
    });
    
    console.log('✅ Latest pointer updated');
}

/**
 * Clean old backups
 */
async function cleanupOldBackups() {
    console.log('\n🧹 Cleaning old backups...');
    
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
    
    // Clean daily backups older than retention period
    const deletedDaily = await r2Storage.cleanOldBackups('daily/', retentionDays);
    
    console.log(`✅ Cleanup complete: ${deletedDaily.length} old backups removed`);
    
    return deletedDaily;
}

/**
 * Main backup function
 */
export async function runBackup(type = 'daily') {
    const startTime = Date.now();
    const backupLog = {
        timestamp: new Date().toISOString(),
        type,
        status: 'in_progress',
        stages: [],
    };

    try {
        console.log('🚀 Starting backup process...\n');
        console.log('=' .repeat(60));
        console.log(`Backup Type: ${type}`);
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log('=' .repeat(60) + '\n');

        // Stage 1: Connect to database
        console.log('Stage 1/6: Database Connection');
        await connectToDatabase();
        backupLog.stages.push({ name: 'database_connection', status: 'success' });

        // Stage 2: Export data
        console.log('\nStage 2/6: Data Export');
        const backupData = await createBackupData();
        backupLog.stages.push({ 
            name: 'data_export', 
            status: 'success',
            collections: backupData.statistics.totalCollections,
            documents: backupData.statistics.totalDocuments,
        });

        // Stage 3: Compress
        console.log('\nStage 3/6: Compression');
        const compressed = await compressBackup(backupData);
        backupLog.stages.push({ 
            name: 'compression', 
            status: 'success',
            originalSize: compressed.originalSize,
            compressedSize: compressed.compressedSize,
            ratio: compressed.compressionRatio,
        });

        // Stage 4: Upload to R2
        console.log('\nStage 4/6: Cloud Upload');
        const uploadResult = await uploadBackup(compressed, type);
        backupLog.stages.push({ 
            name: 'cloud_upload', 
            status: 'success',
            key: uploadResult.key,
            url: uploadResult.url,
        });

        // Stage 5: Verify
        console.log('\nStage 5/6: Backup Verification');
        const isVerified = await r2Storage.verify(uploadResult.key, uploadResult.checksum);
        
        if (!isVerified) {
            throw new Error('Backup verification failed!');
        }
        
        backupLog.stages.push({ name: 'verification', status: 'success' });

        // Stage 6: Update latest & cleanup
        console.log('\nStage 6/6: Maintenance');
        await updateLatestPointer(uploadResult);
        
        // Only cleanup if this is a daily backup
        const deletedBackups = type === 'daily' ? await cleanupOldBackups() : [];
        
        backupLog.stages.push({ 
            name: 'maintenance', 
            status: 'success',
            deletedBackups: deletedBackups.length,
        });

        // Success
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        backupLog.status = 'success';
        backupLog.duration = duration;
        backupLog.result = uploadResult;

        console.log('\n' + '=' .repeat(60));
        console.log('✅ BACKUP COMPLETED SUCCESSFULLY');
        console.log('=' .repeat(60));
        console.log(`⏱️  Duration: ${duration}s`);
        console.log(`📦 Size: ${(compressed.compressedSize / 1024).toFixed(2)} KB`);
        console.log(`☁️  Location: ${uploadResult.key}`);
        console.log('=' .repeat(60) + '\n');

        return backupLog;

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        backupLog.status = 'failed';
        backupLog.duration = duration;
        backupLog.error = error.message;

        console.error('\n❌ BACKUP FAILED');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);

        return backupLog;
    } finally {
        // Disconnect from database
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('👋 Disconnected from MongoDB');
        }
    }
}

/**
 * Run backup (for CLI usage)
 */
if (process.argv[1] && process.argv[1].includes('backup.js')) {
    const type = process.argv[2] || 'daily';
    
    runBackup(type)
        .then(log => {
            console.log('\n📋 Backup Log:');
            console.log(JSON.stringify(log, null, 2));
            process.exit(log.status === 'success' ? 0 : 1);
        })
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

export default runBackup;
