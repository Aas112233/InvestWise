import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const errorHandler = (err, req, res, next) => {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    // Log error for backend debugging
    console.error(`[Error] ${req.method} ${req.url}:`, err);

    // Append to log file
    const logPath = path.join(__dirname, '../logs/server_errors.log');
    const logEntry = `[${new Date().toISOString()}] ${req.method} ${req.url} - ${err.message}\nStack: ${err.stack}\n\n`;

    try {
        if (!fs.existsSync(path.dirname(logPath))) {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
        }
        fs.appendFileSync(logPath, logEntry);
    } catch (e) {
        console.error('Failed to write to error log:', e);
    }

    res.status(statusCode).json({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

export { errorHandler, notFound };
