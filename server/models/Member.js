import mongoose from 'mongoose';

const memberSchema = mongoose.Schema(
    {
        memberId: {
            type: String,
            required: true,
            unique: true, // Example: "MEM001"
        },
        name: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
        },
        phone: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            default: 'Member',
        },
        shares: {
            type: Number,
            required: true,
            default: 0,
        },
        totalContributed: {
            type: Number,
            required: true,
            default: 0,
        },
        status: {
            type: String,
            enum: ['active', 'pending', 'inactive'],
            default: 'active',
        },
        avatar: {
            type: String,
        },
        lastActive: {
            type: Date,
        },
        // Link to a User account if they have dashboard access
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        }
    },
    {
        timestamps: true,
    }
);

const Member = mongoose.model('Member', memberSchema);

export default Member;
