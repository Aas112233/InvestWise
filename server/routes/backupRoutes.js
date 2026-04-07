import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { EJSON } from 'bson';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { protect, requireRole } from '../middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const OBJECT_ID_LIKE_KEYS = new Set([
    '_id',
    'userId',
    'memberId',
    'fundId',
    'projectId',
    'createdBy',
    'updatedBy',
    'authorizedBy',
    'linkedFundId',
    'resourceId'
]);

const DATE_LIKE_KEYS = new Set([
    'date',
    'createdAt',
    'updatedAt',
    'lastLogin',
    'lastActive',
    'timestamp',
    'expiresAt',
    'blacklistedAt'
]);

const isObjectIdString = (value) =>
    typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const isIsoDateString = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(new Date(value).getTime());

const restoreBsonTypes = (value, key = '') => {
    if (Array.isArray(value)) {
        return value.map((item) => restoreBsonTypes(item, key));
    }

    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) {
        return Object.fromEntries(
            Object.entries(value).map(([childKey, childValue]) => [childKey, restoreBsonTypes(childValue, childKey)])
        );
    }

    if (isObjectIdString(value) && OBJECT_ID_LIKE_KEYS.has(key)) {
        return new mongoose.Types.ObjectId(value);
    }

    if (isIsoDateString(value) && DATE_LIKE_KEYS.has(key)) {
        return new Date(value);
    }

    return value;
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// All backup routes require Admin role
router.use(protect);
router.use(requireRole('Admin', 'Administrator'));

/**
 * GET /api/backup/download
 * Download complete database backup as JSON
 */
router.get('/download', async (req, res) => {
    try {
        console.log('[Backup] Starting backup creation...');
        
        // Get all collections
        const collections = await mongoose.connection.db.collections();
        
        const backup = {
            metadata: {
                version: '2.0',
                timestamp: new Date().toISOString(),
                database: mongoose.connection.name,
                createdBy: req.user?.email || 'Unknown',
                format: 'EJSON'
            },
            data: {}
        };

        // Export each collection
        for (const collection of collections) {
            const collectionName = collection.collectionName;
            
            // Skip internal MongoDB collections
            if (collectionName.startsWith('system.')) continue;
            
            const documents = await collection.find({}).toArray();
            backup.data[collectionName] = documents;
            
            console.log(`[Backup] Exported ${collectionName}: ${documents.length} documents`);
        }

        // Preserve ObjectIds/Dates so restore does not break references.
        const jsonData = EJSON.stringify(backup, null, 2);
        
        // Set headers for download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=investwise-backup-${Date.now()}.json`);
        res.setHeader('Content-Length', Buffer.byteLength(jsonData));
        
        console.log('[Backup] Backup created successfully');
        res.send(jsonData);
        
    } catch (error) {
        console.error('[Backup] Backup failed:', error);
        res.status(500).json({ 
            success: false,
            message: 'Backup creation failed',
            error: error.message 
        });
    }
});

/**
 * POST /api/backup/restore
 * Restore database from uploaded JSON backup file
 */
router.post('/restore', upload.single('backup'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        console.log('[Restore] Starting restore process...');
        
        if (!req.file) {
            throw new Error('No backup file provided');
        }

        // Parse backup file while preserving BSON types such as ObjectId and Date.
        const backupData = EJSON.parse(req.file.buffer.toString());
        
        if (!backupData.data || typeof backupData.data !== 'object') {
            throw new Error('Invalid backup file format');
        }

        console.log('[Restore] Backup metadata:', backupData.metadata);
        
        // Clear existing data and restore
        const collections = Object.keys(backupData.data);
        let totalRestored = 0;

        for (const collectionName of collections) {
            const documents = backupData.data[collectionName];
            
            // Get the collection
            const collection = mongoose.connection.collection(collectionName);
            
            // Clear existing data
            await collection.deleteMany({}, { session });
            console.log(`[Restore] Cleared collection: ${collectionName}`);
            
            // Insert backup data
            if (Array.isArray(documents) && documents.length > 0) {
                const normalizedDocuments = documents.map((doc) => restoreBsonTypes(doc));
                await collection.insertMany(normalizedDocuments, { session });
                totalRestored += documents.length;
                console.log(`[Restore] Restored ${collectionName}: ${documents.length} documents`);
            } else {
                console.log(`[Restore] Restored empty collection: ${collectionName}`);
            }
        }

        await session.commitTransaction();
        console.log(`[Restore] Restore completed successfully. Total documents: ${totalRestored}`);
        
        res.json({
            success: true,
            message: 'Backup restored successfully',
            documentsRestored: totalRestored,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        await session.abortTransaction();
        console.error('[Restore] Restore failed:', error);
        
        res.status(500).json({ 
            success: false,
            message: 'Restore failed: ' + error.message,
            error: error.message 
        });
    } finally {
        session.endSession();
    }
});

/**
 * GET /api/backup/list
 * List available backup files (if storing on server)
 */
router.get('/list', async (req, res) => {
    try {
        // This endpoint can be used if you store backups on the server
        // For now, we're doing direct download/upload
        res.json({
            success: true,
            message: 'Use download endpoint to create backups',
            backups: []
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            message: 'Failed to list backups',
            error: error.message 
        });
    }
});

export default router;
