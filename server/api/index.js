// Vercel serverless entry point
// This file is the entry for @vercel/node runtime.
//
// BUILD: this file is at api/index.js in the repo root, but vercel.json
// sets outputDirectory=dist. The build step copies api/ → dist/api/ so the
// compiled handler lives at dist/api/index.js.  Imports here resolve RELATIVE
// TO dist/api/ (the runtime location after copy), NOT the repo root.

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Compiled output lives one level up from dist/api/ (i.e. in dist/)
import app from '../app.js';
import { connectDB } from '../config/database.js';

// Lazy-connect to database on first request (serverless cold start)
let dbConnected = false;

export default async function handler(req, res) {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
    } catch (error) {
      console.error('Database connection failed:', error);
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable — database not reachable',
        code: 'DB_UNAVAILABLE',
      });
    }
  }
  return app(req, res);
}
