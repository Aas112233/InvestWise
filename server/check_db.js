import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const check = async () => {
    console.log('Attempting to connect to MongoDB...');
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('CONNECTED');
        process.exit(0);
    } catch (err) {
        console.error('FAILED TO CONNECT:', err.message);
        process.exit(1);
    }
};

check();
