import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Member from './models/Member.js';
import Transaction from './models/Transaction.js';
import Fund from './models/Fund.js';
import connectDB from './config/db.js';

dotenv.config();

const JSON_FILE_PATH = 'C:/Users/mhass/Downloads/investment-club-data-2026-01-30.json';

const seedJSON = async () => {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        // Read JSON File
        if (!fs.existsSync(JSON_FILE_PATH)) {
            throw new Error(`File not found: ${JSON_FILE_PATH}`);
        }
        const rawData = fs.readFileSync(JSON_FILE_PATH, 'utf-8');
        const jsonData = JSON.parse(rawData);

        console.log(`Loaded JSON data. Members: ${jsonData.members.length}, Payments: ${jsonData.payments.length}`);

        // --- PHASE 1: SEED MEMBERS ---
        console.log('\n--- PHASE 1: Seeding Members ---');

        // Map to store mapping from JSON ID to MongoDB _id
        const memberIdMap = new Map(); // jsonId (number) -> mongoId (ObjectId)

        const membersToInsert = [];

        for (const m of jsonData.members) {
            // Check if member already exists (by unique memberId or email check if we had it, but mostly memberId)
            // We'll generate a memberId like MEM_013
            const memberId = `MEM_${String(m.id).padStart(3, '0')}`;

            // Handle missing fields
            const email = m.email || `missing_email_${m.id}@investwise.local`;
            const phone = m.phone || (m.contact ? m.contact : `0000000000`);

            // Prepare object
            membersToInsert.push({
                memberId: memberId,
                name: m.name,
                email: email,
                phone: phone,
                status: m.status || 'active',
                shares: m.share_amount || 0,
                totalContributed: 0, // Will be recalculated from transactions or set initial if needed
                // _jsonId is not in schema, so we can't save it directly unless we modify schema. 
                // We will rely on finding it after insertion or insert one by one to get IDs.
            });
        }

        // We insert one by one or upsert to ensure we get the IDs for the map
        // Given typically small dataset, one by one is fine and safer for mapping
        let createdMembersCount = 0;
        for (let i = 0; i < jsonData.members.length; i++) {
            const rawMember = jsonData.members[i];
            const memberData = membersToInsert[i];

            // Use findOneAndUpdate with upsert to prevent duplicates if run multiple times
            // Keying off memberId
            const memberDoc = await Member.findOneAndUpdate(
                { memberId: memberData.memberId },
                memberData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            memberIdMap.set(rawMember.id, memberDoc._id);
            createdMembersCount++;
        }
        console.log(`Processed ${createdMembersCount} members.`);


        // --- PHASE 2: SEED FUNDS ---
        console.log('\n--- PHASE 2: Seeding Funds ---');
        let primaryFund = await Fund.findOne({ type: 'Primary' });

        if (!primaryFund) {
            console.log('Creating Primary Fund...');
            primaryFund = await Fund.create({
                name: 'Corporate Main Fund',
                type: 'Primary',
                balance: 0, // Will update based on transactions later if needed, or set base
                description: 'Main investment and operational fund imported from JSON'
            });
        }
        console.log(`Using Fund: ${primaryFund.name} (${primaryFund._id})`);


        // --- PHASE 3: SEED TRANSACTIONS (DEPOSITS) ---
        console.log('\n--- PHASE 3: Seeding Transactions ---');

        const paymentsToInsert = [];
        let skippedPayments = 0;

        for (const p of jsonData.payments) {
            // Find linked member
            const memberObjectId = memberIdMap.get(p.member_id);

            if (!memberObjectId) {
                console.warn(`Warning: Payment ${p.id} skipped. Member ID ${p.member_id} not found in seeded members.`);
                skippedPayments++;
                continue;
            }

            // Map Status
            let status = 'Success';
            if (p.status && p.status.toLowerCase() === 'pending') status = 'Pending';
            if (p.status && p.status.toLowerCase() === 'rejected') status = 'Failed';

            // Clean Description
            const description = p.description || `Deposit for ${p.payment_date}`;

            // Map Payment Method to Schema Enum
            let method = p.payment_method;
            if (method) {
                const m = method.toLowerCase();
                if (m.includes('bkash') || m.includes('mobile')) method = 'Mobile Banking';
                else if (m.includes('bank') || m.includes('transfer')) method = 'Bank';
                else if (m.includes('cash')) method = 'Cash';
                else if (m.includes('check')) method = 'Check';
                else method = 'Other';
            } else {
                method = 'Cash';
            }

            paymentsToInsert.push({
                type: 'Deposit',
                amount: p.amount,
                description: description,
                date: new Date(p.payment_date),
                status: status,
                memberId: memberObjectId,
                fundId: primaryFund._id,
                depositMethod: method,
                category: 'Member Deposit'
            });
        }

        if (paymentsToInsert.length > 0) {
            // Bulk insert is fine here as we don't need IDs back immediately for dependencies
            await Transaction.insertMany(paymentsToInsert);
        }

        console.log(`Seeded ${paymentsToInsert.length} transactions. Skipped: ${skippedPayments}`);

        // Update Fund Balance (Optional, but good for consistency)
        // Simple aggregation to get total balance
        const totalDeposits = paymentsToInsert.reduce((sum, t) => (t.status === 'Success' ? sum + t.amount : sum), 0);

        // We typically add to existing balance, or recalculate. 
        // For now, let's just log it. Updating might double count if we run script multiple times without clearing.
        console.log(`Total Value of Seeded Deposits: ${totalDeposits}`);

        // Update Member Total Contributed
        console.log('\nUpdating Member Contributions...');
        for (const [jsonId, mongoId] of memberIdMap.entries()) {
            // Calculate total for this member
            const memberTotal = paymentsToInsert
                .filter(p => p.memberId === mongoId && p.status === 'Success')
                .reduce((sum, p) => sum + p.amount, 0);

            if (memberTotal > 0) {
                await Member.findByIdAndUpdate(mongoId, { totalContributed: memberTotal });
            }
        }
        console.log('Member contributions updated.');

        console.log('\n--- SEEDING COMPLETE ---');
        process.exit(0);

    } catch (error) {
        console.error(`Error Seeding Data: ${error.message}`);
        fs.writeFileSync('seed_error.log', `${error.message}\n${error.stack}`);
        process.exit(1);
    }
};

seedJSON();
