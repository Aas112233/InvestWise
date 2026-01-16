import mongoose from 'mongoose';

const transactionSchema = mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['Deposit', 'Withdrawal', 'Investment', 'Expense', 'Earning'],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        date: {
            type: Date,
            default: Date.now,
        },
        status: {
            type: String,
            enum: ['Success', 'Processing', 'Failed', 'Pending', 'Flagged', 'Completed'],
            default: 'Success',
        },
        // Optional links to other entities
        memberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Member',
        },
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
        },
        fundId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Fund',
        },
        handlingOfficer: {
            type: String,
            required: false
        },
        authorizedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        }
    },
    {
        timestamps: true,
    }
);

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
