import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load backend environment variables
<<<<<<< HEAD
dotenv.config({ path: '.env' });
=======
dotenv.config({ path: '../.env' });
>>>>>>> ed09dec2872d0de8166310824c2c266af199c066

// Connection retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds

let isConnecting = false;
let reconnectTimeout = null;

const connectDB = async (retryCount = 0) => {
  if (isConnecting) return;
  
  isConnecting = true;
  
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      retryWrites: true,
      retryReads: true,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    isConnecting = false;
    
    // Reset retry count on successful connection
    connectDB.retryCount = 0;
  } catch (error) {
    isConnecting = false;
    console.error(`❌ MongoDB Connection Error (Attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`);
    
    // Store retry count on the function itself
    if (!connectDB.retryCount) {
      connectDB.retryCount = 0;
    }
    connectDB.retryCount = retryCount + 1;
    
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    
    // Calculate retry delay with exponential backoff
    const retryDelay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryCount), MAX_RETRY_DELAY);
    
    // Don't exit process in development to allow server to stay up
    if (process.env.NODE_ENV === 'production' && retryCount >= MAX_RETRIES - 1) {
      console.error('❌ Max retries reached. Exiting process.');
      process.exit(1);
    }
    
    // Schedule retry
    console.log(`🔄 Retrying in ${retryDelay / 1000} seconds...`);
    reconnectTimeout = setTimeout(() => {
      connectDB(connectDB.retryCount);
    }, retryDelay);
    
    throw error;
  }
};

// Graceful shutdown handlers
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Monitor connection events
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
  setImmediate(() => {
    if (!isConnecting && mongoose.connection.readyState !== 1) {
      connectDB(0);
    }
  });
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

export default connectDB;
