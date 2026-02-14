import { body } from 'express-validator';
import { validate } from './validator.js';

export const projectValidation = [
    body('title').trim().notEmpty().withMessage('Project title is required'),
    body('description').optional().trim(),
    body('budget').optional().isNumeric().withMessage('Budget must be a number'),
    body('status').optional().isIn(['In Progress', 'Completed', 'Review']).withMessage('Invalid status'),
    validate
];

export const fundValidation = [
    body('name').trim().notEmpty().withMessage('Fund name is required'),
    body('balance').isNumeric().withMessage('Balance must be a number'),
    body('type').optional().trim(),
    validate
];

export const transactionValidation = [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('description').optional().trim(),
    validate
];
