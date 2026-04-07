/**
 * List Available Backups
 * GET /api/backup/list
 */
import r2Storage from '../../utils/cloudflareR2.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { prefix = '' } = req.query;
        
        const backups = await r2Storage.listBackups(prefix);

        // Format for display
        const formattedBackups = backups.map(backup => ({
            ...backup,
            sizeKB: (backup.size / 1024).toFixed(2),
            age: getAge(backup.lastModified),
        }));

        return res.status(200).json({
            success: true,
            count: formattedBackups.length,
            backups: formattedBackups,
        });

    } catch (error) {
        console.error('Failed to list backups:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
        });
    }
}

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
