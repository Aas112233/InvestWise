import mongoose from 'mongoose';

const auditLogSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false, // Could be system action or unauthenticated attempt
        },
        userName: {
            type: String, // Snapshot of name in case user is deleted
        },
        action: {
            type: String,
            required: true,
            uppercase: true, // e.g., 'LOGIN', 'CREATE_PROJECT'
        },
        resourceType: {
            type: String, // e.g., 'Project', 'Transaction', 'Auth'
        },
        resourceId: {
            type: String,
            required: false,
        },
        details: {
            type: mongoose.Schema.Types.Mixed, // JSON object with before/after state or metadata
        },
        ipAddress: {
            type: String,
        },
        userAgent: {
            type: String,
        },
        status: {
            type: String,
            enum: ['SUCCESS', 'FAILURE', 'WARNING'],
            default: 'SUCCESS',
        }
    },
    {
        timestamps: true,
    }
);

// Index for faster searching/filtering
auditLogSchema.index({ action: 1, resourceType: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
