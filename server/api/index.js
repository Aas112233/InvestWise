import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import app from '../app.js';

export default async function handler(req, res) {
 try {
  if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
   await connectDB();
  }
 } catch (error) {
  console.warn(` Database bootstrap failed for ${req.method} ${req.url}: ${error.message}`);
  // Continue so health and graceful error responses still work.
 }

 return app(req, res);
}
