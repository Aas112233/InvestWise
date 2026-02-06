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
        console.error('FAILED TO CONNECT');
        console.error('Error Name:', err.name);
        console.error('Error Code:', err.code);
        console.error('Error CodeName:', err.codeName);
        console.error('Full Error:', err);
        process.exit(1);
    }
};

check();
