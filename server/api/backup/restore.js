/**
 * Restore from Backup
 * POST /api/backup/restore
 * Body: { backupKey: 'daily/backup-2026-04-07.json.gz' }
 */
import mongoose from 'mongoose';
import zlib from 'zlib';
import { promisify } from 'util';
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
            warning: 'This will overwrite existing data!'
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

        // Stage 3: Connect to database
        console.log('Stage 3/4: Connecting to database...');
        const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
        await mongoose.connect(mongoURI);
        restoreLog.stages.push({ name: 'database_connection', status: 'success' });

        // Stage 4: Restore collections
        console.log('Stage 4/4: Restoring collections...');
        const restoreResults = await restoreCollections(backupData);
        restoreLog.stages.push({ name: 'restore', status: 'success', results: restoreResults });

        // Success
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        restoreLog.status = 'success';
        restoreLog.duration = duration;

        await mongoose.disconnect();

        console.log(`✅ Restore completed in ${duration}s`);

        return res.status(200).json(restoreLog);

    } catch (error) {
        restoreLog.status = 'failed';
        restoreLog.error = error.message;
        restoreLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
        }

        console.error('Restore failed:', error);
        return res.status(500).json(restoreLog);
    }
}

/**
 * Restore collections to database
 */
async function restoreCollections(backupData) {
    const results = {};
    const collections = backupData.collections;

    for (const [collectionName, collectionData] of Object.entries(collections)) {
        console.log(`Restoring ${collectionName}...`);

        try {
            // Get the model dynamically
            const modelName = capitalizeFirst(collectionName);
            let Model;
            
            try {
                Model = mongoose.model(modelName);
            } catch {
                // Try singular name
                Model = mongoose.model(collectionName.replace(/s$/, ''));
            }

            if (!Model) {
                console.warn(`⚠️  Model not found for ${collectionName}`);
                results[collectionName] = { status: 'skipped', reason: 'Model not found' };
                continue;
            }

            // Clear existing data (optional - make this configurable in production)
            const deletedCount = await Model.deleteMany({});
            console.log(`  Deleted ${deletedCount.deletedCount} existing documents`);

            // Insert backup data
            if (collectionData.data.length > 0) {
                await Model.insertMany(collectionData.data);
            }

            results[collectionName] = {
                status: 'success',
                documentsRestored: collectionData.count,
            };

            console.log(`✅ Restored ${collectionData.count} documents to ${collectionName}`);
        } catch (error) {
            console.error(`❌ Failed to restore ${collectionName}:`, error.message);
            results[collectionName] = {
                status: 'failed',
                error: error.message,
            };
        }
    }

    return results;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(0, -1);
}
