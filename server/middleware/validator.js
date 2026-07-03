import { body, validationResult } from 'express-validator';

export const validate = (req, res, next) => {
 const errors = validationResult(req);
 if (!errors.isEmpty()) {
 require('fs').appendFileSync('validation.log', JSON.stringify(errors.array(), null, 2) + '\\n');
 return res.status(400).json({ errors: errors.array() });
 }
 next();
};

export const loginValidation = [
 body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
 body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
 validate
];

export const registerValidation = [
 body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
 body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
 body('password')
 .isLength({ min: 12 })
 .withMessage('Password must be at least 12 characters')
 .matches(/[a-z]/)
 .withMessage('Password must contain at least one lowercase letter')
 .matches(/[A-Z]/)
 .withMessage('Password must contain at least one uppercase letter')
 .matches(/\d/)
 .withMessage('Password must contain at least one number')
 .matches(/[@$!%*?&#^()_+\-=\[\]{}|;:,.<>\/~`]/)
 .withMessage('Password must contain at least one special character'),
 validate
];

export const memberValidation = [
 body('name').trim().notEmpty().withMessage('Name is required'),
 body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
 validate
];
