import mongoose from 'mongoose';

const goalSchema = mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User',
        },
        title: {
            type: String,
            required: true,
        },
        description: {
            type: String,
        },
        targetAmount: {
            type: Number,
            required: true,
        },
        currentAmount: {
            type: Number,
            required: true,
            default: 0,
        },
        deadline: {
            type: Date,
        },
        status: {
            type: String,
            enum: ['In Progress', 'Achieved', 'Cancelled'],
            default: 'In Progress',
        },
        type: {
            type: String,
            enum: ['Savings', 'Investment', 'Other'],
            default: 'Other',
        },
        linkedProject: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
        },
    },
    {
        timestamps: true,
    }
);

const Goal = mongoose.model('Goal', goalSchema);

export default Goal;
