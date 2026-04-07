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

// Basic field indexes
transactionSchema.index({ memberId: 1 });
transactionSchema.index({ fundId: 1 });
transactionSchema.index({ projectId: 1 });

// CRITICAL: Compound indexes for common query patterns
// 1. List transactions by type (e.g., deposits list) - MOST COMMON QUERY
transactionSchema.index({ type: 1, date: -1 });

// 2. Member transactions with type and date
transactionSchema.index({ memberId: 1, type: 1, date: -1 });

// 3. Fund transactions with date
transactionSchema.index({ fundId: 1, date: -1 });

// 4. Project transactions with date
transactionSchema.index({ projectId: 1, date: -1 });

// 5. Status filtering (used in totals aggregation)
transactionSchema.index({ status: 1, type: 1 });

// 6. Date and type compound
transactionSchema.index({ date: -1, type: 1 });

// Comprehensive text search index
transactionSchema.index({ description: 'text', type: 'text', referenceNumber: 'text' });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
