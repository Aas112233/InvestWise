import mongoose from 'mongoose';

const memberSchema = mongoose.Schema(
    {
        memberId: {
            type: String,
            required: [true, 'Member ID is required'],
            unique: true,
            index: true,
            trim: true,
        },
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
            index: true,
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address'],
            lowercase: true,
            trim: true,
            index: true,
        },
        phone: {
            type: String,
            required: [true, 'Phone number is required'],
            match: [/^\+?[0-9\s-]{10,15}$/, 'Please fill a valid phone number'],
            trim: true,
        },
        role: {
            type: String,
            default: 'Member',
            trim: true,
        },
        shares: {
            type: Number,
            required: true,
            default: 0,
            min: [0, 'Shares cannot be negative'],
        },
        totalContributed: {
            type: Number,
            required: true,
            default: 0,
            min: [0, 'Contribution cannot be negative'],
        },
        status: {
            type: String,
            enum: ['active', 'pending', 'inactive', 'suspended', 'terminated'],
            default: 'active',
        },
        avatar: {
            type: String,
        },
        lastActive: {
            type: Date,
            default: Date.now,
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
        // Link to a User account if they have dashboard access
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        hasUserAccess: {
            type: Boolean,
            default: false,
        }
    },
    {
        timestamps: true,
    }
);

// Indexes for common searches
memberSchema.index({ name: 'text', email: 'text', memberId: 'text' });

const Member = mongoose.model('Member', memberSchema);

export default Member;
