import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SENSITIVE_HEADER_KEYS = new Set([
 'authorization',
 'cookie',
 'set-cookie',
 'x-api-key',
 'x-auth-token',
 'x-refresh-token',
]);

const sanitizeHeaders = (headers = {}) =>
 Object.fromEntries(
 Object.entries(headers).map(([key, value]) => [
 key,
 SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value,
 ])
 );

// Error types and their safe messages
const errorTypeMap = {
 'ValidationError': 'Validation failed. Please check your input.',
 'CastError': 'Invalid data format.',
 'JsonWebTokenError': 'Invalid authentication token.',
 'TokenExpiredError': 'Authentication token has expired.',
 'MongoServerError': 'Database error occurred.',
 'ECONNREFUSED': 'Unable to connect to service.',
 'ETIMEDOUT': 'Request timed out.',
};

// Extract safe error information
const getSafeError = (err, statusCode) => {
 // Preserve explicit client-facing validation/business rule messages for 4xx responses.
 if (statusCode >= 400 && statusCode < 500 && err.message) {
 return {
 message: err.message,
 code: err.code || 'CLIENT_ERROR',
 name: err.name || 'ClientError',
 };
 }

 // Check for known error types
 const errorName = err.name || 'UnknownError';

 // Map to user-friendly message
 const safeMessage = errorTypeMap[errorName] || errorTypeMap[err.code] || 'An unexpected error occurred.';

 return {
 message: safeMessage,
 code: err.code || 'INTERNAL_ERROR',
 name: errorName,
 };
};

const errorHandler = (err, req, res, next) => {
 const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
 const isExpectedAuthRefresh =
 statusCode === 401 &&
 (err.code === 'TOKEN_EXPIRED' || err.name === 'TokenExpiredError');

 // Log full error details server-side (never exposed to client)
 if (isExpectedAuthRefresh) {
 console.warn(`[Auth Refresh] ${req.method} ${req.url}:`, {
 message: err.message,
 name: err.name,
 code: err.code
 });
 } else {
 console.error(`[Error] ${req.method} ${req.url}:`, {
 message: err.message,
 name: err.name,
 code: err.code,
 stack: err.stack,
 details: err.details,
 });
 }

// Append to secure log file
 const logPath = path.join(__dirname, '../logs/server_errors.log');
 const logEntry = [
 `[${new Date().toISOString()}] ${req.method} ${req.url} - ${err.name}: ${err.message}`,
 `Code: ${err.code}`,
 `Stack: ${err.stack}`,
 `Headers: ${JSON.stringify(sanitizeHeaders(req.headers))}`,
 '',
 ].join('\n');

 try {
 if (!isExpectedAuthRefresh) {
 fs.promises.mkdir(path.dirname(logPath), { recursive: true })
 .then(() => fs.promises.appendFile(logPath, `${logEntry}\n`))
 .catch((writeError) => {
 console.error('Failed to write to error log:', writeError);
 });
 }
 } catch (e) {
 console.error('Failed to write to error log:', e);
 }

 // Get safe error information for client
 const safeError = getSafeError(err, statusCode);

 // NEVER expose stack traces - even in development
 // Stack traces reveal internal code structure to attackers
 res.status(statusCode).json({
 success: false,
 message: safeError.message,
 code: safeError.code,
 // Only include error ID for support team to look up in logs
 errorId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
 // Timestamp for debugging
 timestamp: new Date().toISOString(),
 // Path that caused the error (safe to expose)
 path: req.path,
 });
};

const notFound = (req, res, next) => {
 const error = new Error(`Not Found - ${req.originalUrl}`);
 res.status(404);
 next(error);
};

export { errorHandler, notFound };
