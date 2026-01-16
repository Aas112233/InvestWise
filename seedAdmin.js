import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import connectDB from './config/db.js';

dotenv.config();

const seedAdmin = async () => {
    try {
        await connectDB();

        // Check if admin already exists
        let admin = await User.findOne({ email: 'admin@investwise.com' });
        
        // Full permissions for all modules
        const fullPermissions = {
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
            SETTINGS: 'WRITE',
            GOALS: 'WRITE'
        };

        if (admin) {
            // Update existing admin with full permissions
            admin.permissions = fullPermissions;
            await admin.save();
            console.log('✅ Admin user updated with full permissions!');
        } else {
            // Create new admin user
            admin = await User.create({
                name: 'System Administrator',
                email: 'admin@investwise.com',
                password: 'Admin@123456',
                role: 'Administrator',
                avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
                permissions: fullPermissions
            });
            console.log('✅ Admin user created successfully!');
        }

        console.log('📧 Email: admin@investwise.com');
        console.log('🔐 Password: Admin@123456');
        console.log('👤 Role: Administrator');
        console.log('🔓 Access: All modules (WRITE)');
        process.exit(0);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

seedAdmin();
