import asyncHandler from 'express-async-handler';
import Goal from '../models/Goal.js';

// @desc    Fetch all goals for a user
// @route   GET /api/goals
// @access  Private
const getGoals = asyncHandler(async (req, res) => {
    const goals = await Goal.find({ user: req.user._id });
    res.json(goals);
});

// @desc    Create a new goal
// @route   POST /api/goals
// @access  Private
const createGoal = asyncHandler(async (req, res) => {
    const { title, description, targetAmount, currentAmount, deadline, type, linkedProject } = req.body;

    const goal = new Goal({
        user: req.user._id,
        title,
        description,
        targetAmount,
        currentAmount,
        deadline,
        type,
        linkedProject,
    });

    const createdGoal = await goal.save();
    res.status(201).json(createdGoal);
});

// @desc    Update a goal
// @route   PUT /api/goals/:id
// @access  Private
const updateGoal = asyncHandler(async (req, res) => {
    const goal = await Goal.findById(req.params.id);

    if (goal) {
        if (goal.user.toString() !== req.user._id.toString()) {
            res.status(401);
            throw new Error('Not authorized to update this goal');
        }

        goal.title = req.body.title || goal.title;
        goal.description = req.body.description || goal.description;
        goal.targetAmount = req.body.targetAmount || goal.targetAmount;
        goal.currentAmount = req.body.currentAmount !== undefined ? req.body.currentAmount : goal.currentAmount;
        goal.deadline = req.body.deadline || goal.deadline;
        goal.status = req.body.status || goal.status;
        goal.type = req.body.type || goal.type;
        goal.linkedProject = req.body.linkedProject || goal.linkedProject;

        const updatedGoal = await goal.save();
        res.json(updatedGoal);
    } else {
        res.status(404);
        throw new Error('Goal not found');
    }
});

// @desc    Delete a goal
// @route   DELETE /api/goals/:id
// @access  Private
const deleteGoal = asyncHandler(async (req, res) => {
    const goal = await Goal.findById(req.params.id);

    if (goal) {
        if (goal.user.toString() !== req.user._id.toString()) {
            res.status(401);
            throw new Error('Not authorized to delete this goal');
        }

        await goal.deleteOne();
        res.json({ message: 'Goal removed' });
    } else {
        res.status(404);
        throw new Error('Goal not found');
    }
});

export { getGoals, createGoal, updateGoal, deleteGoal };
