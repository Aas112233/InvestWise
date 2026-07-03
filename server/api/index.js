import connectDB from '../db/connection.js';
import app from '../app.js';

// Track whether we've initialized the connection
let dbInitialized = false;

export default async function handler(req, res) {
  try {
    // connectDB handles its own caching — it returns the existing
    // Drizzle instance if already connected (warm Vercel invocations)
    await connectDB();
    dbInitialized = true;
  } catch (error) {
    console.warn(`Database bootstrap failed for ${req.method} ${req.url}: ${error.message}`);
    // Continue so health check and graceful error responses still work.
    // The checkDbConnection middleware in app.js will return 503 if DB is down.
  }

  return app(req, res);
}
