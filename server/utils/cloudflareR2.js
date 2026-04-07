/**
 * Cloudflare R2 Storage Utility
 * S3-compatible API for backup storage
 */
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config();

class CloudflareR2 {
    constructor() {
        this.client = null;
        this.bucket = process.env.R2_BUCKET_NAME || 'investwise-backups';
        this.initialized = false;
    }

    /**
     * Initialize R2 client
     */
    init() {
        if (this.initialized) return true;

        const accountId = process.env.R2_ACCOUNT_ID;
        const accessKeyId = process.env.R2_ACCESS_KEY_ID;
        const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

        if (!accountId || !accessKeyId || !secretAccessKey) {
            console.warn('⚠️  Cloudflare R2 credentials not configured');
            return false;
        }

        try {
            this.client = new S3Client({
                region: 'auto',
                endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId,
                    secretAccessKey,
                },
                // Force path style for R2
                forcePathStyle: true,
            });

            this.initialized = true;
            console.log(`✅ Cloudflare R2 client initialized (Bucket: ${this.bucket})`);
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize R2 client:', error.message);
            return false;
        }
    }

    /**
     * Upload file to R2
     * @param {string} key - File path in bucket
     * @param {Buffer} body - File content
     * @param {object} metadata - Additional metadata
     * @returns {Promise<string>} - Upload URL
     */
    async upload(key, body, metadata = {}) {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            // Calculate checksum for verification (store in metadata only, not ContentMD5)
            const checksum = createHash('md5').update(body).digest('base64');

            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: 'application/gzip',
                // FIXED: Removed ContentMD5 to avoid conflict with custom checksum metadata
                Metadata: {
                    'backup-timestamp': new Date().toISOString(),
                    'backup-checksum': checksum,
                    ...metadata,
                },
            });

            await this.client.send(command);

            console.log(`✅ Uploaded to R2: ${key} (${(body.length / 1024).toFixed(2)} KB)`);

            // Return the R2 URL
            const accountId = process.env.R2_ACCOUNT_ID;
            return `https://${this.bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;
        } catch (error) {
            console.error('❌ R2 upload failed:', error.message);
            throw new Error(`Failed to upload to R2: ${error.message}`);
        }
    }

    /**
     * Download file from R2
     * @param {string} key - File path in bucket
     * @returns {Promise<Buffer>} - File content
     */
    async download(key) {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            const response = await this.client.send(command);
            const body = await this.streamToBuffer(response.Body);

            console.log(`✅ Downloaded from R2: ${key} (${(body.length / 1024).toFixed(2)} KB)`);

            return body;
        } catch (error) {
            console.error('❌ R2 download failed:', error.message);
            throw new Error(`Failed to download from R2: ${error.message}`);
        }
    }

    /**
     * List all backups in R2
     * @param {string} prefix - Folder prefix (e.g., 'daily/')
     * @returns {Promise<Array>} - List of backup files
     */
    async listBackups(prefix = '') {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            const command = new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix,
                // FIXED: Removed Delimiter to list ALL files recursively across folders
            });

            const response = await this.client.send(command);
            const backups = [];

            if (response.Contents) {
                for (const obj of response.Contents) {
                    // Skip the 'latest/' pointer file
                    if (obj.Key.includes('latest/')) continue;

                    // Determine backup type from folder path
                    const type = obj.Key.startsWith('monthly/') ? 'monthly' : 'daily';

                    // Extract filename from full path
                    const filename = obj.Key.split('/').pop();

                    backups.push({
                        key: obj.Key,
                        filename: filename,
                        size: obj.Size,
                        lastModified: obj.LastModified,
                        type: type,
                        url: `https://${this.bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${obj.Key}`,
                    });
                }
            }

            // Sort by lastModified (newest first)
            backups.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

            return backups;
        } catch (error) {
            console.error('❌ Failed to list backups:', error.message);
            throw new Error(`Failed to list backups: ${error.message}`);
        }
    }

    /**
     * Delete a backup from R2
     * @param {string} key - File path in bucket
     * @returns {Promise<boolean>} - Success status
     */
    async delete(key) {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            const command = new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            await this.client.send(command);

            console.log(`✅ Deleted from R2: ${key}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to delete backup:', error.message);
            throw new Error(`Failed to delete backup: ${error.message}`);
        }
    }

    /**
     * Verify backup integrity
     * @param {string} key - File path in bucket
     * @param {string} expectedChecksum - Expected MD5 checksum
     * @returns {Promise<boolean>} - Verification result
     */
    async verify(key, expectedChecksum) {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            });

            const response = await this.client.send(command);
            const actualChecksum = response.Metadata?.['backup-checksum'];

            if (!actualChecksum) {
                console.warn('⚠️  No checksum metadata found');
                return false;
            }

            const isValid = actualChecksum === expectedChecksum;
            console.log(`🔍 Backup verification: ${isValid ? '✅ PASSED' : '❌ FAILED'}`);

            return isValid;
        } catch (error) {
            console.error('❌ Backup verification failed:', error.message);
            return false;
        }
    }

    /**
     * Clean old backups (older than retention period)
     * @param {string} prefix - Folder prefix
     * @param {number} retentionDays - Keep backups for this many days
     * @returns {Promise<Array>} - Deleted backup keys
     */
    async cleanOldBackups(prefix = 'daily/', retentionDays = 30) {
        if (!this.init()) {
            throw new Error('R2 client not initialized');
        }

        try {
            const backups = await this.listBackups(prefix);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            const deleted = [];

            for (const backup of backups) {
                if (new Date(backup.lastModified) < cutoffDate) {
                    // Don't delete monthly backups
                    if (!backup.key.includes('monthly/')) {
                        await this.delete(backup.key);
                        deleted.push(backup.key);
                        console.log(`🗑️  Deleted old backup: ${backup.key}`);
                    }
                }
            }

            console.log(`✅ Cleaned ${deleted.length} old backups`);
            return deleted;
        } catch (error) {
            console.error('❌ Failed to clean old backups:', error.message);
            throw new Error(`Failed to clean old backups: ${error.message}`);
        }
    }

    /**
     * Convert stream to buffer
     * @param {ReadableStream} stream - Response body stream
     * @returns {Promise<Buffer>} - Buffer
     */
    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
}

// Singleton instance
const r2Storage = new CloudflareR2();

export default r2Storage;
