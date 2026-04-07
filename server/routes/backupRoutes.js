/**
 * Backup API Routes (Express)
 * Cloudflare R2 backup/restore endpoints
 */
import express from 'express';
import mongoose from 'mongoose';
import zlib from 'zlib';
import { promisify } from 'util';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import r2Storage from '../utils/cloudflareR2.js';

const gunzip = promisify(zlib.gunzip);

const router = express.Router();

// Import models dynamically to handle missing models gracefully
let Member, Transaction, Project, Fund, User, SystemSettings;

async function loadModels() {
    try {
        Member = (await import('../models/Member.js')).default;
        Transaction = (await import('../models/Transaction.js')).default;
        Project = (await import('../models/Project.js')).default;
        Fund = (await import('../models/Fund.js')).default;
        User = (await import('../models/User.js')).default;
        SystemSettings = (await import('../models/SystemSettings.js')).default;
    } catch (error) {
        console.warn('⚠️  Some models not found');
    }
}

const BACKUP_COLLECTIONS = [
    { name: 'members', model: null },
    { name: 'transactions', model: null },
    { name: 'projects', model: null },
    { name: 'funds', model: null },
    { name: 'users', model: null },
    { name: 'systemSettings', model: null },
];

/**
 * Manual Backup Trigger
 * POST /api/backup/manual
 */
router.post('/manual', protect, requirePermission('REPORTS', 'READ'), async (req, res) => {
    try {
        const backupType = req.body.type || 'daily';
        const startTime = Date.now();

        console.log(`🚀 Manual Backup Triggered: ${backupType}`);

        // Load models
        await loadModels();

        // Export data
        const backupData = {
            metadata: {
                version: '1.0',
                timestamp: new Date().toISOString(),
                database: mongoose.connection.name,
            },
            collections: {},
            statistics: {
                totalCollections: 0,
                totalDocuments: 0,
            },
        };

        for (const collection of BACKUP_COLLECTIONS) {
            if (!collection.model) {
                try {
                    collection.model = (await import(`../models/${capitalizeFirst(collection.name)}.js`)).default;
                } catch {
                    continue;
                }
            }

            const documents = await collection.model.find({}).lean();
            backupData.collections[collection.name] = {
                name: collection.name,
                count: documents.length,
                data: documents,
            };
            backupData.statistics.totalCollections++;
            backupData.statistics.totalDocuments += documents.length;
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
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`✅ Backup completed in ${duration}s`);

        return res.status(200).json({
            status: 'success',
            type: backupType,
            duration,
            filename,
            key,
            collections: backupData.statistics.totalCollections,
            documents: backupData.statistics.totalDocuments,
        });

    } catch (error) {
        console.error('Manual backup failed:', error);
        return res.status(500).json({
            status: 'failed',
            error: error.message
        });
    }
});

/**
 * List All Backups
 * GET /api/backup/list
 */
router.get('/list', protect, requirePermission('REPORTS', 'READ'), async (req, res) => {
    try {
        const { prefix = '' } = req.query;
        const backups = await r2Storage.listBackups(prefix);

        // Format for display (add sizeKB and age, filename/type already provided)
        const formattedBackups = backups.map(backup => ({
            ...backup,
            sizeKB: (backup.size / 1024).toFixed(2),
            age: getAge(backup.lastModified),
        }));

        return res.status(200).json({
            success: true,
            count: formattedBackups.length,
            backups: formattedBackups
        });

    } catch (error) {
        console.error('Failed to list backups:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Restore from Cloud Backup
 * POST /api/backup/restore
 */
router.post('/restore', protect, requirePermission('REPORTS', 'READ'), async (req, res) => {
    try {
        const { backupKey, confirm } = req.body;

        if (!backupKey) {
            return res.status(400).json({ error: 'backupKey is required' });
        }

        if (!confirm) {
            return res.status(400).json({
                error: 'Restore requires confirmation. Set confirm: true',
                warning: 'This will overwrite existing data!'
            });
        }

        console.log(`🔄 Cloud Restore initiated: ${backupKey}`);

        // Download backup
        const backupBuffer = await r2Storage.download(backupKey);

        // Decompress
        const decompressed = await gunzip(backupBuffer);
        const backupData = JSON.parse(decompressed.toString());

        // Load models
        await loadModels();

        // Restore collections
        const results = {};
        for (const [collectionName, collectionData] of Object.entries(backupData.collections)) {
            try {
                let Model;
                try {
                    Model = (await import(`../models/${capitalizeFirst(collectionName)}.js`)).default;
                } catch {
                    results[collectionName] = { status: 'skipped', reason: 'Model not found' };
                    continue;
                }

                // Clear existing data
                await Model.deleteMany({});

                // Insert backup data
                if (collectionData.data.length > 0) {
                    await Model.insertMany(collectionData.data);
                }

                results[collectionName] = {
                    status: 'success',
                    documentsRestored: collectionData.count,
                };
            } catch (error) {
                results[collectionName] = {
                    status: 'failed',
                    error: error.message,
                };
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Backup restored successfully',
            results
        });

    } catch (error) {
        console.error('Failed to restore backup:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Helper: Gzip compress
 */
const gzip = promisify(zlib.gzip);

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

/**
 * Helper: Capitalize first letter and remove 's' for model name
 */
function capitalizeFirst(str) {
    const singular = str.replace(/s$/, '');
    return singular.charAt(0).toUpperCase() + singular.slice(1);
}

export default router;
