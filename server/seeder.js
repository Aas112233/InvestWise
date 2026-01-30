
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/User.js';
import connectDB from './config/db.js';

// Reconstruct __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from server directory first, then root
dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGO_URI) {
    dotenv.config({ path: path.join(__dirname, '../.env') });
}

console.log('Mongo URI found:', !!process.env.MONGO_URI);

const importData = async () => {
    try {
        await connectDB();

        // Check if admin already exists
        const existingAdmin = await User.findOne({ email: 'admin@investwise.com' });

        if (existingAdmin) {
            console.log('Admin user exists. Updating permissions...');
            // Update permissions even if user exists
            existingAdmin.permissions = {
                DASHBOARD: 'WRITE',
                MEMBERS: 'WRITE',
                DEPOSITS: 'WRITE',
                REQUEST_DEPOSIT: 'WRITE',
                TRANSACTIONS: 'WRITE',
                PROJECT_MANAGEMENT: 'WRITE',
                FUNDS_MANAGEMENT: 'WRITE',
                EXPENSES: 'WRITE',
                ANALYSIS: 'WRITE',
                REPORTS: 'WRITE',
                GOALS: 'WRITE',
                DIVIDENDS: 'WRITE',
                SETTINGS: 'WRITE'
            };
            await existingAdmin.save();
            console.log('Admin permissions updated to full access.');
            process.exit();
        }

        const adminUser = {
            name: 'Admin User',
            email: 'admin@investwise.com',
            password: 'password123', // Will be hashed by pre-save hook
            role: 'Administrator',
            permissions: {
                DASHBOARD: 'WRITE',
                MEMBERS: 'WRITE',
                DEPOSITS: 'WRITE',
                REQUEST_DEPOSIT: 'WRITE',
                TRANSACTIONS: 'WRITE',
                PROJECT_MANAGEMENT: 'WRITE',
                FUNDS_MANAGEMENT: 'WRITE',
                EXPENSES: 'WRITE',
                ANALYSIS: 'WRITE',
                REPORTS: 'WRITE',
                GOALS: 'WRITE',
                DIVIDENDS: 'WRITE',
                SETTINGS: 'WRITE'
            },
            avatar: '',
        };

        await User.create(adminUser);

        console.log('Admin User Created with Full Access!');
        console.log('Email: admin@investwise.com');
        console.log('Password: password123');

        process.exit();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

importData();
