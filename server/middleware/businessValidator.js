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

export const memberValidation = [
 body('name').trim().notEmpty().withMessage('Name is required'),
 body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
 validate
];

export const goalValidation = [
 body('title').trim().notEmpty().withMessage('Goal title is required'),
 body('description').optional().trim(),
 body('targetAmount').isFloat({ min: 0.01 }).withMessage('Target amount must be greater than 0'),
 body('currentAmount').optional().isFloat({ min: 0 }).withMessage('Current amount must not be negative'),
 body('deadline').optional().isISO8601().toDate().withMessage('Deadline must be a valid date'),
 body('status').optional().isIn(['In Progress', 'Achieved', 'Cancelled']).withMessage('Invalid status'),
 body('type').optional().isIn(['Savings', 'Investment', 'Other']).withMessage('Invalid goal type'),
 body('linkedProject').optional().isMongoId().withMessage('Invalid project ID'),
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

export const transferValidation = [
 body('amount').isFloat({ min: 0.01, max: 10000000 }).withMessage('Amount must be positive'),
 body('fromFundId').isMongoId().withMessage('Invalid source fund ID'),
 body('toFundId').isMongoId().withMessage('Invalid target fund ID'),
 body('description').optional().trim().escape(),
 validate
];

export const dividendValidation = [
 body('amount').isFloat({ min: 0.01, max: 10000000 }).withMessage('Amount must be positive'),
 body('type').isIn(['Global', 'Project']).withMessage('Invalid dividend type'),
 body('projectId').if(body('type').equals('Project')).isMongoId().withMessage('Project ID is required for Project dividends'),
 body('sourceFundId').if(body('type').equals('Global')).isMongoId().withMessage('Fund ID is required for Global dividends'),
 body('description').optional().trim().escape(),
 validate
];

export const equityTransferValidation = [
 body('fromMemberId').isMongoId().withMessage('Invalid source member ID'),
 body('reason').trim().notEmpty().withMessage('Reason is required').escape(),
 body('transfers').isArray({ min: 1 }).withMessage('At least one transfer is required'),
 body('transfers.*.toMemberId').isMongoId().withMessage('Invalid recipient member ID'),
 body('transfers.*.shares').isFloat({ min: 0.01 }).withMessage('Shares must be positive'),
 body('transfers.*.amount').optional().isFloat({ min: 0 }).withMessage('Amount must be non-negative'),
 validate
];

export const bulkDepositValidation = [
 body('fundId').isMongoId().withMessage('Invalid fund ID'),
 body('commonMonth').optional().trim().notEmpty().escape(),
 body('deposits').isArray({ min: 1 }).withMessage('At least one deposit is required'),
 body('deposits.*.memberId').isMongoId().withMessage('Invalid member ID'),
 body('deposits.*.amount').isFloat({ min: 0.01, max: 10000000 }).withMessage('Amount must be positive'),
 validate
];
