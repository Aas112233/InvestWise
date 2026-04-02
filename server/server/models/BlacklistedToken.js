import mongoose from 'mongoose';

const blacklistedTokenSchema = mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    type: {
        type: String,
        enum: ['access', 'refresh'],
        required: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    expiresAt: {
        type: Date,
        required: true,
        // TTL index handled by schema.index() below
    },
    blacklistedAt: {
        type: Date,
        default: Date.now,
    },
    reason: {
        type: String,
        enum: ['logout', 'password_change', 'security', 'user_request'],
        default: 'logout',
    },
}, {
    timestamps: true,
});

// TTL index to automatically remove expired tokens
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const BlacklistedToken = mongoose.model('BlacklistedToken', blacklistedTokenSchema);

export default BlacklistedToken;
