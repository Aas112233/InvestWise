import mongoose from 'mongoose';

const transactionSchema = mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['Deposit', 'Withdrawal', 'Investment', 'Expense', 'Earning', 'Dividend', 'Equity-Transfer', 'Adjustment', 'Transfer'],
            required: true,
        },
        amount: {
            type: Number,
            required: [true, 'Amount is required'],
            min: [0, 'Amount cannot be negative'],
        },
        description: {
            type: String,
            required: [true, 'Description is required'],
            trim: true,
        },
        category: {
            type: String,
            required: false,
            trim: true,
            index: true,
        },
        referenceNumber: {
            type: String,
            required: false,
            trim: true,
            index: true,
        },
        date: {
            type: Date,
            default: Date.now,
            index: true,
        },
        status: {
            type: String,
            enum: ['Success', 'Processing', 'Failed', 'Pending', 'Flagged', 'Completed'],
            default: 'Success',
            index: true,
        },
        // Optional links to other entities
        memberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Member',
            index: true,
        },
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        fundId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Fund',
            index: true,
        },
        handlingOfficer: {
            type: String,
            required: false,
            trim: true,
        },
        depositMethod: {
            type: String,
            enum: ['Cash', 'Bank', 'Mobile Banking', 'Check', 'Other'],
            required: false,
            index: true,
        },
        authorizedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        // Financial Snapshots (Enterprise Audit)
        balanceBefore: {
            type: Number,
            required: false, // Optional for legacy or non-balance impacting tx
        },
        balanceAfter: {
            type: Number,
            required: false,
        },
        // Audit Fields
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        }
    },
    {
        timestamps: true,
    }
);

// Comprehensive search index
transactionSchema.index({ description: 'text', type: 'text', referenceNumber: 'text' });
transactionSchema.index({ createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
