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
        balance: {
            type: Number,
            required: true,
            default: 0,
        },
        description: {
            type: String,
        },
        handlingOfficer: {
            type: String, // Name of the person responsible for this fund
        },
        // Potentially track history here or in Transaction model
    },
    {
        timestamps: true,
    }
);

const Fund = mongoose.model('Fund', fundSchema);

export default Fund;
