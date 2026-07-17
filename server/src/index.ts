import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/database.js';

const start = async () => {
  // Fail fast — a running API without a database is worse than not running at all.
  // Every route that touches the DB would fail with "Database not connected" anyway.
  try {
    await connectDB();
  } catch (error) {
    console.error('❌ Database connection failed at startup — aborting.');
    console.error((error as Error).message);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`✓ InvestWise API v2 running on port ${env.PORT}`);
    console.log(`  Environment: ${env.NODE_ENV}`);
  });

  server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
};

start();
