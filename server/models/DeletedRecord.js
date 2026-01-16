import mongoose from 'mongoose';

const deletedRecordSchema = mongoose.Schema(
    {
        originalId: {
            type: String,
            required: true,
        },
        collectionName: {
            type: String,
            required: true,
        },
        data: {
            type: Object,
            required: true,
        },
        reason: {
            type: String
        },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        deletedAt: {
            type: Date,
            default: Date.now,
        }
    },
    {
        timestamps: true,
    }
);

const DeletedRecord = mongoose.model('DeletedRecord', deletedRecordSchema);

export default DeletedRecord;
