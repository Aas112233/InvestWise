import mongoose from 'mongoose';

const fundSchema = mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
        },
        type: {
            type: String,
            enum: ['DEPOSIT', 'PROJECT', 'OTHER', 'Primary', 'Reserve'], // Primary/Reserve kept for legacy support
            required: true,
            default: 'OTHER'
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'ARCHIVED'],
            default: 'ACTIVE',
        },
        currency: {
            type: String,
            default: 'BDT',
        },
        linkedProjectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
        },
        accountNumber: {
            type: String,
            unique: true,
            sparse: true,
            uppercase: true,
            index: true
        },
        balance: {
            type: Number,
            required: true,
            default: 0,
        },
        lastReconciledAt: {
            type: Date,
        },
        reconciliationStatus: {
            type: String,
            enum: ['VERIFIED', 'DISCREPANCY', 'PENDING'],
            default: 'PENDING'
        },
        handlingOfficer: {
            type: String, // Name of the person responsible for this fund
        },
        description: {
            type: String,
        },
        isSystemAsset: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true,
    }
);

const Fund = mongoose.model('Fund', fundSchema);

export default Fund;
