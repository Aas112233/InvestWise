import mongoose from 'mongoose';

const sessionSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    ipAddress: {
        type: String,
        required: true,
        index: true,
    },
    userAgent: {
        type: String,
        required: true,
    },
    location: {
        country: String,
        city: String,
        region: String,
    },
    loginTime: {
        type: Date,
        default: Date.now,
        index: true,
    },
    lastActivity: {
        type: Date,
        default: Date.now,
    },
    logoutTime: {
        type: Date,
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    isExpired: {
        type: Boolean,
        default: false,
    },
    deviceInfo: {
        type: String,
        default: 'Unknown',
    },
    osInfo: {
        type: String,
        default: 'Unknown',
    },
    browserInfo: {
        type: String,
        default: 'Unknown',
    },
}, {
    timestamps: true,
});

// Index for active sessions
sessionSchema.index({ user: 1, isActive: 1 });
sessionSchema.index({ sessionId: 1, isActive: 1 });

// TTL index to auto-expire old sessions (30 days after logout)
sessionSchema.index({ logoutTime: 1 }, { expireAfterSeconds: 2592000 });

const Session = mongoose.model('Session', sessionSchema);

export default Session;
