import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import connectDB from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';

dotenv.config();



const app = express();

// Trust Proxy for Render/Heroku (required for correctly logging IP and rate limiting)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Production CORS Configuration
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);

        // Allow any localhost origin for development (Flutter web, etc.)
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*') || origin.startsWith('http://localhost')) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 86400 // 24 hours
};

app.use(helmet());
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(logger);

app.get('/', (req, res) => {
    res.send('API is running...');
});

import healthRoutes from './routes/healthRoutes.js';
app.use('/api', healthRoutes);

import authRoutes from './routes/authRoutes.js';

app.use('/api/auth', authRoutes);
import memberRoutes from './routes/memberRoutes.js';
app.use('/api/members', apiLimiter, memberRoutes);
import projectRoutes from './routes/projectRoutes.js';
import fundRoutes from './routes/fundRoutes.js';

app.use('/api/projects', apiLimiter, projectRoutes);
app.use('/api/funds', apiLimiter, fundRoutes);
import financeRoutes from './routes/financeRoutes.js';
app.use('/api/finance', apiLimiter, financeRoutes);
import reportRoutes from './routes/reportRoutes.js';
app.use('/api/reports', apiLimiter, reportRoutes);
import analyticsRoutes from './routes/analyticsRoutes.js';
app.use('/api/analytics', apiLimiter, analyticsRoutes);

import goalRoutes from './routes/goalRoutes.js';
app.use('/api/goals', apiLimiter, goalRoutes);
import auditRoutes from './routes/auditRoutes.js';
app.use('/api/audit', apiLimiter, auditRoutes);

import settingsRoutes from './routes/settingsRoutes.js';
app.use('/api/settings', apiLimiter, settingsRoutes);

// Error Handling
app.use(notFound);
app.use(errorHandler);


const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();

        app.listen(PORT, () => {
            console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to connect to the database. Server not started.');
        process.exit(1);
    }
};

startServer();
