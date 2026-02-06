
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Member from './models/Member.js';
import Project from './models/Project.js';
import Transaction from './models/Transaction.js';
import Fund from './models/Fund.js';
import connectDB from './config/db.js';

dotenv.config();

const seedData = async () => {
    try {
        await connectDB();

        // Clear existing data (except users)
        await Member.deleteMany({});
        await Project.deleteMany({});
        await Transaction.deleteMany({});
        await Fund.deleteMany({});

        console.log('Cleared existing data');

        // 1. Create Primary Fund
        const primaryFund = await Fund.create({
            name: 'Corporate Main Fund',
            type: 'Primary',
            balance: 2500000,
            description: 'Main investment and operational fund'
        });

        // 2. Create Members
        const members = await Member.insertMany([
            { memberId: 'MEM001', name: 'Ethan Hunt', email: 'ethan@mission.com', phone: '555-0101', shares: 50, totalContributed: 500000, status: 'active' },
            { memberId: 'MEM002', name: 'Nova Skye', email: 'nova@skye.com', phone: '555-0102', shares: 35, totalContributed: 350000, status: 'active' },
            { memberId: 'MEM003', name: 'Chloe Price', email: 'chloe@price.com', phone: '555-0103', shares: 25, totalContributed: 250000, status: 'active' },
            { memberId: 'MEM004', name: 'James Bond', email: 'james@007.com', phone: '555-0007', shares: 40, totalContributed: 400000, status: 'active' },
            { memberId: 'MEM005', name: 'Sufian Ahmed', email: 'sufian@ahmed.com', phone: '555-0105', shares: 30, totalContributed: 300000, status: 'active' },
            { memberId: 'MEM006', name: 'Liam Parker', email: 'liam@parker.com', phone: '555-0106', shares: 45, totalContributed: 450000, status: 'active' },
        ]);

        console.log('Seeded 6 members');

        // 3. Create Projects with member involvement
        const projects = await Project.insertMany([
            {
                title: 'High-Rise Apartment Complex',
                category: 'Real Estate',
                description: 'Development of a 20-story luxury apartment building.',
                initialInvestment: 1200000,
                totalShares: 120,
                status: 'In Progress',
                startDate: new Date('2023-09-01'),
                projectFundHandler: 'Liam Parker',
                involvedMembers: [
                    { memberId: members[0]._id, memberName: members[0].name, sharesInvested: 30 },
                    { memberId: members[1]._id, memberName: members[1].name, sharesInvested: 25 },
                    { memberId: members[5]._id, memberName: members[5].name, sharesInvested: 40 }
                ]
            },
            {
                title: 'Tech Growth Stock Bundle',
                category: 'Stocks',
                description: 'Diversified portfolio of emerging technology stocks.',
                initialInvestment: 800000,
                totalShares: 80,
                status: 'In Progress',
                startDate: new Date('2023-10-15'),
                projectFundHandler: 'James Bond',
                involvedMembers: [
                    { memberId: members[2]._id, memberName: members[2].name, sharesInvested: 20 },
                    { memberId: members[3]._id, memberName: members[3].name, sharesInvested: 35 },
                    { memberId: members[4]._id, memberName: members[4].name, sharesInvested: 25 }
                ]
            },
            {
                title: 'Bitcoin Strategic Reserve',
                category: 'Crypto',
                description: 'Long-term holding of BTC as a hedge against inflation.',
                initialInvestment: 450000,
                totalShares: 45,
                status: 'In Progress',
                startDate: new Date('2023-12-01'),
                projectFundHandler: 'Nova Skye',
                involvedMembers: [
                    { memberId: members[1]._id, memberName: members[1].name, sharesInvested: 25 },
                    { memberId: members[4]._id, memberName: members[4].name, sharesInvested: 20 }
                ]
            },
            {
                title: 'Gold & Silver Metals Bundle',
                category: 'Commodities',
                description: 'Physical bullion and metal futures.',
                initialInvestment: 600000,
                totalShares: 60,
                status: 'Review',
                startDate: new Date('2024-01-20'),
                projectFundHandler: 'Ethan Hunt',
                involvedMembers: [
                    { memberId: members[0]._id, memberName: members[0].name, sharesInvested: 35 }
                ]
            }
        ]);

        console.log('Seeded 4 projects with member involvement');

        // 4. Create Transactions (Last 6 Months)
        const now = new Date();
        const transactions = [];

        // Generate deposits and investments for each member over several months
        for (let i = 0; i < 6; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 15);

            // Monthly deposits for each member
            members.forEach((m) => {
                transactions.push({
                    type: 'Deposit',
                    amount: 20000 + (Math.random() * 10000),
                    description: `Monthly contribution - ${date.toLocaleString('default', { month: 'long' })}`,
                    date: date,
                    memberId: m._id,
                    fundId: primaryFund._id,
                    status: 'Success'
                });
            });

            // Monthly expenses
            transactions.push({
                type: 'Expense',
                amount: 15000 + (Math.random() * 5000),
                description: `Office utilities and management fees - ${date.toLocaleString('default', { month: 'long' })}`,
                date: date,
                fundId: primaryFund._id,
                status: 'Success'
            });

            // Investment transactions for project members
            if (i < 4) {
                projects.forEach((p) => {
                    p.involvedMembers.forEach((im) => {
                        transactions.push({
                            type: 'Investment',
                            amount: 50000 + (Math.random() * 20000),
                            description: `Investment in ${p.title}`,
                            date: date,
                            memberId: im.memberId,
                            projectId: p._id,
                            fundId: primaryFund._id,
                            status: 'Success'
                        });
                    });
                });
            }
        }

        await Transaction.insertMany(transactions);

        console.log(`Seeded ${transactions.length} transactions`);
        console.log('Database seeded successfully!');
        process.exit(0);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

seedData();
