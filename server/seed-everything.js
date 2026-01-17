import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Member from './models/Member.js';
import Fund from './models/Fund.js';
import Transaction from './models/Transaction.js';
import Project from './models/Project.js';

dotenv.config();

const members = [
    { memberId: 'IW-001', name: 'Dr. Arifin Shuvo', email: 'shuvo@investwise.com', phone: '01711122233', shares: 10, avatar: 'https://ui-avatars.com/api/?name=Arifin+Shuvo&background=BFF300&color=000' },
    { memberId: 'IW-002', name: 'Nusrat Imrose Tisha', email: 'tisha@investwise.com', phone: '01811122233', shares: 5, avatar: 'https://ui-avatars.com/api/?name=Nusrat+Tisha&background=00E5FF&color=000' },
    { memberId: 'IW-003', name: 'Chanchal Chowdhury', email: 'chanchal@investwise.com', phone: '01911122233', shares: 15, avatar: 'https://ui-avatars.com/api/?name=Chanchal+Chowdhury&background=FF4081&color=000' },
    { memberId: 'IW-004', name: 'Joya Ahsan', email: 'joya@investwise.com', phone: '01611122233', shares: 8, avatar: 'https://ui-avatars.com/api/?name=Joya+Ahsan&background=7C4DFF&color=000' },
    { memberId: 'IW-005', name: 'Afran Nisho', email: 'nisho@investwise.com', phone: '01511122233', shares: 12, avatar: 'https://ui-avatars.com/api/?name=Afran+Nisho&background=FFAB40&color=000' },
    { memberId: 'IW-006', name: 'Mehazabien Chowdhury', email: 'mehaz@investwise.com', phone: '01411122233', shares: 20, avatar: 'https://ui-avatars.com/api/?name=Mehazabien&background=E040FB&color=000' },
    { memberId: 'IW-007', name: 'Mosharraf Karim', email: 'mosharraf@investwise.com', phone: '01311122233', shares: 25, avatar: 'https://ui-avatars.com/api/?name=Mosharraf&background=00B0FF&color=000' }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB for Multi-Year Financial Seeding...');

        // 1. Clear Data
        console.log('Initiating strategic purge of existing records...');
        await Member.deleteMany({});
        await Fund.deleteMany({});
        await Transaction.deleteMany({});
        await Project.deleteMany({});

        // 2. Create Base Funds
        console.log('Establishing corporate funds...');
        const primaryFund = await Fund.create({
            name: 'Enterprise Primary Capital',
            type: 'Primary',
            balance: 2500000, // Large starting balance for operations
            description: 'Main liquidity pool for investments and operational burn.',
            handlingOfficer: 'Chief Financial Officer'
        });

        const depositFund = await Fund.create({
            name: 'Global Stakeholder Treasury',
            type: 'DEPOSIT',
            balance: 0,
            description: 'Central vault for all member contributions and equity holdings.',
            handlingOfficer: 'Treasury Manager'
        });

        const reserveFund = await Fund.create({
            name: 'Emergency Reserve Fund',
            type: 'Reserve',
            balance: 500000,
            description: 'Contingency capital for market fluctuations.',
            handlingOfficer: 'Risk Management'
        });

        // 3. Create Members
        console.log('Seeding strategic partners...');
        const createdMembers = await Member.insertMany(members);

        // 4. Generate 3 Years of Data (2023, 2024, 2025)
        console.log('Synthesizing 3 years of fiscal history...');
        const yearMonths = [];
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 2;

        for (let y = startYear; y <= currentYear; y++) {
            for (let m = 0; m < 12; m++) {
                // Stop if we hit future months in current year
                if (y === currentYear && m > new Date().getMonth()) break;
                yearMonths.push({ year: y, month: m });
            }
        }

        const sharePrice = 1000;
        let totalTreasuryBalance = 0;

        for (const member of createdMembers) {
            let memberLifetimeContribution = 0;
            console.log(`Processing contributions for ${member.name}...`);

            for (const period of yearMonths) {
                const amount = member.shares * sharePrice;
                const txDate = new Date(period.year, period.month, 15);

                const monthName = txDate.toLocaleString('default', { month: 'long' });

                await Transaction.create({
                    type: 'Deposit',
                    amount: amount,
                    description: `Equity contribution for ${monthName} ${period.year}`,
                    date: txDate,
                    status: 'Completed',
                    memberId: member._id,
                    fundId: depositFund._id,
                    handlingOfficer: 'Treasury System'
                });

                memberLifetimeContribution += amount;
                totalTreasuryBalance += amount;

                // Random Periodic Bonuses/Extra Investments (every ~8 months)
                if (Math.random() > 0.85) {
                    const bonusAmount = 5000 + (Math.floor(Math.random() * 5) * 1000);
                    await Transaction.create({
                        type: 'Deposit',
                        amount: bonusAmount,
                        description: `Supplementary investment - Strategic Growth`,
                        date: new Date(period.year, period.month, 20),
                        status: 'Completed',
                        memberId: member._id,
                        fundId: depositFund._id,
                        handlingOfficer: 'Treasury Manager'
                    });
                    memberLifetimeContribution += bonusAmount;
                    totalTreasuryBalance += bonusAmount;
                }
            }

            await Member.findByIdAndUpdate(member._id, {
                totalContributed: memberLifetimeContribution,
                lastActive: new Date()
            });
        }

        await Fund.findByIdAndUpdate(depositFund._id, { balance: totalTreasuryBalance });

        // 5. Generate Historical Operational Expenses
        console.log('Logging historical operational burn...');
        const expenseCategories = ['Operational', 'Marketing', 'Legal', 'Travel', 'Technology', 'Maintenance'];
        let totalBurn = 0;

        for (const period of yearMonths) {
            // 2-3 expenses per month
            const expenseCount = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < expenseCount; i++) {
                const amount = 2000 + Math.floor(Math.random() * 8000);
                const category = expenseCategories[Math.floor(Math.random() * expenseCategories.length)];

                await Transaction.create({
                    type: 'Expense',
                    amount: amount,
                    description: `${category} Overhead - Period ${period.month + 1}/${period.year}`,
                    date: new Date(period.year, period.month, 10 + Math.floor(Math.random() * 15)),
                    status: 'Completed',
                    fundId: primaryFund._id,
                    handlingOfficer: 'Finance Admin'
                });
                totalBurn += amount;
            }
        }
        await Fund.findByIdAndUpdate(primaryFund._id, { $inc: { balance: -totalBurn } });

        // 6. Launch Mature and Active Projects
        console.log('Synthesizing venture portfolio...');

        // Project 1: Mature & Successful
        const p1Capital = 500000;
        const project1 = await Project.create({
            title: 'Agro-Tech Supply Chain',
            category: 'Agriculture',
            description: 'End-to-end automation of rural produce distribution to urban hubs.',
            status: 'Completed',
            budget: 600000,
            initialInvestment: p1Capital,
            expectedRoi: 35.0,
            totalShares: 100,
            startDate: new Date(startYear, 2, 1),
            completionDate: new Date(startYear + 1, 8, 15),
            involvedMembers: createdMembers.slice(0, 4).map(m => ({
                memberId: m.memberId,
                memberName: m.name,
                sharesInvested: 25,
                ownershipPercentage: 25
            })),
            currentFundBalance: 750000, // Profitable
            projectFundHandler: 'Supply Chain Lead'
        });

        // Project 2: Active & Growing
        const p2Capital = 300000;
        const project2 = await Project.create({
            title: 'Metropolitan Logistics Hub',
            category: 'Technology',
            description: 'Scaling digital fleet management and AI routing for intra-city logistics.',
            status: 'In Progress',
            budget: 500000,
            initialInvestment: p2Capital,
            expectedRoi: 28.5,
            totalShares: 80,
            startDate: new Date(currentYear - 1, 5, 20),
            involvedMembers: createdMembers.slice(2, 6).map(m => ({
                memberId: m.memberId,
                memberName: m.name,
                sharesInvested: 20,
                ownershipPercentage: 25
            })),
            currentFundBalance: 320000,
            projectFundHandler: 'CTO'
        });

        // Project 3: New Venture
        const p3Capital = 150000;
        const project3 = await Project.create({
            title: 'FinTech Micro-Lending Portal',
            category: 'Legal',
            description: 'AI-driven credit assessment for unbanked entrepreneurs.',
            status: 'Review',
            budget: 250000,
            initialInvestment: p3Capital,
            expectedRoi: 18.0,
            totalShares: 50,
            startDate: new Date(currentYear, 0, 10),
            involvedMembers: createdMembers.slice(4, 7).map(m => ({
                memberId: m.memberId,
                memberName: m.name,
                sharesInvested: 15,
                ownershipPercentage: 33
            })),
            currentFundBalance: 145000,
            projectFundHandler: 'Product Head'
        });

        console.log('Multi-year financial simulation completed.');
        process.exit(0);
    } catch (error) {
        console.error('Simulation Failed:', error.message);
        process.exit(1);
    }
};

seed();
