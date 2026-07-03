/**
 * Vercel Cron Job - Daily Automated Backup
 * Triggered daily at 2:00 AM by Vercel Cron
 */
import r2Storage from '../../utils/cloudflareR2.js';

// Backup function logic (imported to avoid duplication)
import { runBackupLogic } from './utils.js';

export const config = {
    maxDuration: 300, // 5 minutes timeout for large backups
};

export default async function handler(req, res) {
    // Only allow POST from Vercel Cron
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify cron job authorization (optional security)
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🕐 Cron Job Triggered: Daily Backup');

    const startTime = Date.now();
    const backupLog = {
        timestamp: new Date().toISOString(),
        trigger: 'cron',
        type: 'daily',
        status: 'in_progress',
    };

    try {
        // Run the backup
        const result = await runBackupLogic('daily');

        backupLog.status = result.status;
        backupLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);
        backupLog.details = result;

        // Send notification on failure
        if (result.status === 'failed') {
            await sendNotification('❌ Backup Failed', result.error);
        } else {
            await sendNotification('✅ Backup Success', `Completed in ${backupLog.duration}s`);
        }

        return res.status(result.status === 'failed' ? 500 : 200).json(backupLog);

    } catch (error) {
        backupLog.status = 'failed';
        backupLog.error = error.message;
        backupLog.duration = ((Date.now() - startTime) / 1000).toFixed(2);

        await sendNotification('❌ Backup Failed', error.message);

        console.error('Cron backup failed:', error);
        return res.status(500).json(backupLog);
    }
}

/**
 * Send notification (Email/Slack/Discord)
 */
async function sendNotification(subject, message) {
    const notificationUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    
    if (!notificationUrl) {
        console.log('📧 Notification:', subject, '-', message);
        return;
    }

    try {
        const payload = {
            text: `${subject}\n${message}`,
            timestamp: new Date().toISOString(),
        };

        await fetch(notificationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        console.error('Failed to send notification:', error.message);
    }
}
