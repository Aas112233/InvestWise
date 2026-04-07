/**
 * Cleanup Script: Remove all soft-deleted transactions
 * Run this ONCE to clean up old soft-deleted records
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function cleanupSoftDeletedTransactions() {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoURI) {
        console.error('❌ MONGO_URI not found in .env file');
        process.exit(1);
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    const Transaction = (await import('./models/Transaction.js')).default;
    const DeletedRecord = (await import('./models/DeletedRecord.js')).default;

    try {
        // Step 1: Find all soft-deleted transactions
        const softDeleted = await Transaction.find({ isDeleted: true });
        console.log(`\n📊 Found ${softDeleted.length} soft-deleted transactions`);

        if (softDeleted.length === 0) {
            console.log('✅ No soft-deleted transactions to clean up!');
            process.exit(0);
        }

        // Step 2: Archive them to DeletedRecord collection (if not already archived)
        console.log('\n📦 Archiving to deletedrecords collection...');
        let archivedCount = 0;
        
        for (const tx of softDeleted) {
            const alreadyArchived = await DeletedRecord.findOne({ originalId: tx._id });
            
            if (!alreadyArchived) {
                await DeletedRecord.create({
                    originalId: tx._id,
                    collectionName: 'Transaction',
                    data: tx.toObject(),
                    deletedBy: tx.deletedBy || 'System Cleanup',
                    reason: tx.deletionReason || 'Cleanup script - previously soft-deleted',
                    deletedAt: tx.deletedAt || new Date()
                });
                archivedCount++;
            }
        }

        console.log(`✅ Archived ${archivedCount} transactions to deletedrecords`);

        // Step 3: Permanently delete from transactions collection
        console.log('\n🗑️  Permanently deleting from transactions collection...');
        const deleteResult = await Transaction.deleteMany({ isDeleted: true });
        console.log(`✅ Deleted ${deleteResult.deletedCount} transactions`);

        // Step 4: Verify cleanup
        const remaining = await Transaction.countDocuments({ isDeleted: true });
        console.log(`\n✅ Verification: ${remaining} soft-deleted transactions remaining`);

        if (remaining > 0) {
            console.warn('⚠️  Warning: Some soft-deleted transactions still exist. Run again if needed.');
        } else {
            console.log('\n🎉 Cleanup complete! All soft-deleted transactions removed.');
        }

        // Step 5: Show statistics
        const totalTransactions = await Transaction.countDocuments();
        const totalArchived = await DeletedRecord.countDocuments();
        console.log(`\n📈 Database Statistics:`);
        console.log(`   Active transactions: ${totalTransactions}`);
        console.log(`   Archived deletions: ${totalArchived}`);

    } catch (error) {
        console.error('\n❌ Cleanup failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');
    }
}

cleanupSoftDeletedTransactions();
