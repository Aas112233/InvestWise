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

app.use(helmet());
app.use(compression());
app.use(cors());
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
