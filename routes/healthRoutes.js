import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

router.get('/health', (req, res) => {
    const health = {
        uptime: process.uptime(),
        timestamp: Date.now(),
        status: 'OK',
        database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV
    };

    res.status(200).json(health);
});

router.get('/ping', (req, res) => {
    res.status(200).json({ message: 'pong' });
});

export default router;
