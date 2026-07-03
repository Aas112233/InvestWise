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
        },
        status: {
            type: String,
            enum: ['Completed', 'Processing', 'Failed', 'Pending', 'Flagged'],
            default: 'Completed',
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
        },
        // Soft Delete Support (FIXED: Enable transaction recovery)
        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },
        deletedAt: {
            type: Date,
            required: false
        },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false
        },
        deletionReason: {
            type: String,
            required: false,
            trim: true
        }
    },
    {
        timestamps: true,
    }
);

// Indexes for common queries - OPTIMIZED FOR PERFORMANCE

// Basic field indexes (removed duplicates as they are defined inline)

// CRITICAL: Compound indexes for common query patterns

// 1. Member Payments & Totals Calculation (highly optimized for memberController)
transactionSchema.index({ memberId: 1, type: 1, status: 1, isDeleted: 1, date: -1 });

// 2. Fund Ledger queries
transactionSchema.index({ fundId: 1, type: 1, status: 1, isDeleted: 1, date: -1 });

// 3. Project Ledger queries
transactionSchema.index({ projectId: 1, type: 1, status: 1, isDeleted: 1, date: -1 });

// 4. Global Transactions List
transactionSchema.index({ type: 1, status: 1, isDeleted: 1, date: -1 });

// 5. Bulk Deposit Duplicate Protection (financeController)
transactionSchema.index({ memberId: 1, fundId: 1, type: 1, date: 1 });

// Comprehensive text search index
transactionSchema.index({ description: 'text', type: 'text', referenceNumber: 'text' });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
