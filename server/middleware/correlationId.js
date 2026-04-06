import crypto from 'crypto';

/**
 * Correlation ID Middleware
 * Adds a unique correlation ID to each request for distributed tracing
 * and improved debugging across the system.
 */
const correlationId = (req, res, next) => {
 // Generate unique correlation ID
 const correlationId = crypto.randomUUID();
 
 // Attach to request object for use in controllers/logging
 req.correlationId = correlationId;
 
 // Add to response headers for client-side tracking
 res.setHeader('X-Correlation-ID', correlationId);
 res.setHeader('X-Request-ID', correlationId);
 
 // Also add to response body for APIs that return JSON
 const originalJson = res.json.bind(res);
 res.json = (body) => {
 // Only add to JSON responses, not streams/buffers
 if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
 body.correlationId = correlationId;
 }
 return originalJson(body);
 };
 
 next();
};

export default correlationId;
