import mongoose from 'mongoose';

const updateSchema = mongoose.Schema({
    type: { type: String, enum: ['Earning', 'Expense'], required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    date: { type: Date, default: Date.now },
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
        startDate: {
            type: Date,
            required: true,
        },
        completionDate: {
            type: Date,
        },
        projectFundHandler: {
            type: String, // could be a Member ID or Name
        },
        linkedFundId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Fund',
        },
        currentFundBalance: {
            type: Number,
            default: 0,
        },
        // Simple array of objects for members logic (can be refined to Ref Member in future)
        involvedMembers: [{
            memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
            memberName: String,
            sharesInvested: Number
        }],
        updates: [updateSchema],
    },
    {
        timestamps: true,
    }
);

const Project = mongoose.model('Project', projectSchema);

export default Project;
