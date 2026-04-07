/**
 * Manual Backup Trigger
 * POST /api/backup/manual
 */
import { runBackupLogic } from './utils.js';

export const config = {
    maxDuration: 300,
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const backupType = req.body.type || 'daily';
    const startTime = Date.now();

    console.log(`🚀 Manual Backup Triggered: ${backupType}`);

    try {
        const result = await runBackupLogic(backupType);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        return res.status(result.status === 'failed' ? 500 : 200).json({
            status: result.status,
            type: backupType,
            duration,
            result,
        });

    } catch (error) {
        console.error('Manual backup failed:', error);
        return res.status(500).json({
            status: 'failed',
            error: error.message,
        });
    }
}
