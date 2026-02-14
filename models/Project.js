import mongoose from 'mongoose';

const updateSchema = mongoose.Schema({
    type: { type: String, enum: ['Earning', 'Expense'], required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    date: { type: Date, default: Date.now },
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
});

const projectSchema = mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
        },
        category: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        initialInvestment: {
            type: Number,
            required: true,
            default: 0,
        },
        budget: {
            type: Number,
            required: true,
            default: 0,
        },
        expectedRoi: {
            type: Number,
            default: 0, // In percentage
        },
        totalShares: {
            type: Number,
            required: true,
            default: 0,
        },
        status: {
            type: String,
            enum: ['In Progress', 'Completed', 'Review'],
            default: 'In Progress',
        },
        health: {
            type: String,
            enum: ['Stable', 'At Risk', 'Critical'],
            default: 'Stable',
        },
        startDate: {
            type: Date,
            required: true,
        },
        completionDate: {
            type: Date,
        },
        totalEarnings: {
            type: Number,
            default: 0,
        },
        totalExpenses: {
            type: Number,
            default: 0,
        },
        projectFundHandler: {
            type: String,
        },
        linkedFundId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Fund',
        },
        currentFundBalance: {
            type: Number,
            default: 0,
        },
        involvedMembers: [{
            memberId: { type: String },
            sharesInvested: Number,
            ownershipPercentage: Number
        }],
        updates: [updateSchema],
    },
    {
        timestamps: true,
    }
);

const Project = mongoose.model('Project', projectSchema);

export default Project;
