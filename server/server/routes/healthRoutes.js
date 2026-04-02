import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

router.get('/health', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };

    let dbStatus = 'healthy';
    let httpStatus = 200;

    if (dbState === 0 || dbState === 3) {
        dbStatus = 'disconnected';
        httpStatus = 503;
    } else if (dbState === 2) {
        dbStatus = 'connecting';
        httpStatus = 503;
    }

    // Try to ping the database for actual connectivity check
    let dbPingMs = null;
    let dbPingSuccess = false;

    if (dbState === 1) {
        try {
            const pingStart = Date.now();
            await mongoose.connection.db.admin().ping({ maxTimeMS: 2000 });
            dbPingMs = Date.now() - pingStart;
            dbPingSuccess = true;

            if (dbPingMs > 1000) {
                dbStatus = 'slow';
            }
        } catch (error) {
            dbPingSuccess = false;
            dbStatus = 'unreachable';
            httpStatus = 503;
            console.error('Health check - DB ping failed:', error.message);
        }
    }

    const health = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        status: dbStatus === 'healthy' ? 'OK' : 'DEGRADED',
        database: {
            state: dbStateMap[dbState],
            status: dbStatus,
            pingMs: dbPingMs,
            host: mongoose.connection.host || 'unknown',
            name: mongoose.connection.name || 'unknown'
        },
        memory: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB'
        },
        environment: process.env.NODE_ENV || 'development'
    };

    res.status(httpStatus).json(health);
});

router.get('/ping', (req, res) => {
    res.status(200).json({
        message: 'pong',
        timestamp: Date.now()
    });
});

// Detailed database status endpoint
router.get('/db/status', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };

    let stats = {
        state: dbStateMap[dbState],
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name,
        readyState: dbState
    };

    if (dbState === 1) {
        try {
            const serverStatus = await mongoose.connection.db.admin().serverStatus();
            stats.version = serverStatus.version;
            stats.uptime = serverStatus.uptime;
            stats.connections = serverStatus.connections;
            stats.mem = serverStatus.mem;
        } catch (error) {
            stats.error = error.message;
        }
    }

    res.json(stats);
});

export default router;
