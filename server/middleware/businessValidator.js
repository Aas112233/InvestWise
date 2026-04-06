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
 body('amount')
 .isFloat({ min: 0.01, max: 10000000 })
 .withMessage('Amount must be between 0.01 and 10,000,000'),
 body('description')
 .optional()
 .trim()
 .escape()
 .isLength({ max: 500 })
 .withMessage('Description must be less than 500 characters'),
 body('memberId')
 .optional()
 .isMongoId()
 .withMessage('Invalid member ID format'),
 body('fundId')
 .optional()
 .isMongoId()
 .withMessage('Invalid fund ID format'),
 body('projectId')
 .optional()
 .isMongoId()
 .withMessage('Invalid project ID format'),
 body('date')
 .optional()
 .isISO8601()
 .toDate()
 .custom((value) => {
 if (value > new Date()) {
 throw new Error('Future dates are not allowed');
 }
 return true;
 })
 .withMessage('Invalid date format'),
 body('category')
 .optional()
 .trim()
 .escape()
 .isLength({ max: 100 })
 .withMessage('Category must be less than 100 characters'),
 body('referenceNumber')
 .optional()
 .trim()
 .escape()
 .isLength({ max: 50 })
 .withMessage('Reference number must be less than 50 characters'),
 validate
];
