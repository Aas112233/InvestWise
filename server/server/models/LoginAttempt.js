import mongoose from 'mongoose';

const loginAttemptSchema = mongoose.Schema({
    email: {
        type: String,
        required: true,
        index: true,
    },
    ipAddress: {
        type: String,
        required: true,
        index: true,
    },
    success: {
        type: Boolean,
        required: true,
        index: true,
    },
    failureReason: {
        type: String,
        enum: ['invalid_password', 'invalid_email', 'account_locked', 'account_suspended', 'too_many_attempts'],
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
    },
    userAgent: String,
    location: {
        country: String,
        city: String,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});

// Index for tracking attempts per email
loginAttemptSchema.index({ email: 1, timestamp: -1 });
loginAttemptSchema.index({ ipAddress: 1, timestamp: -1 });

// TTL index to auto-delete old records after 90 days
loginAttemptSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

const LoginAttempt = mongoose.model('LoginAttempt', loginAttemptSchema);

export default LoginAttempt;
