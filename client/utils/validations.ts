import { z } from 'zod';

// Bangladesh phone number validation
const bangladeshPhoneRegex = /^(?:\+880|880|01)[1-9]\d{8}$/;

// Email validation
const emailSchema = z.string()
 .min(1, 'Email is required')
 .email('Please enter a valid email address')
 .transform(email => email.toLowerCase().trim());

// Positive number validation
const positiveNumberSchema = z.coerce
 .number({ message: 'Must be a valid number' })
 .positive('Amount must be greater than 0')
 .finite('Amount must be a finite number');

// Positive integer validation
const positiveIntegerSchema = z.coerce
 .number({ message: 'Must be a valid number' })
 .int('Must be a whole number')
 .positive('Must be greater than 0')
 .finite();

// Date validation
const dateSchema = z.string()
 .min(1, 'Date is required')
 .refine((date) => {
 const parsed = new Date(date);
 return !isNaN(parsed.getTime());
 }, 'Please enter a valid date');

const pastDateSchema = dateSchema.refine((date) => {
 const parsed = new Date(date);
 return parsed <= new Date();
}, 'Date cannot be in the future');

// ==========================================
// AUTH SCHEMAS
// ==========================================

export const loginSchema = z.object({
 email: emailSchema,
 password: z.string()
 .min(1, 'Password is required')
 .min(6, 'Password must be at least 6 characters')
});

export const registerSchema = z.object({
 name: z.string().min(2, 'Name must be at least 2 characters').max(100),
 email: emailSchema,
 password: z.string().min(8, 'Password must be at least 8 characters'),
 confirmPassword: z.string(),
 role: z.enum(['Admin', 'Manager', 'Investor', 'Member'])
}).refine((data) => data.password === data.confirmPassword, {
 message: "Passwords don't match",
 path: ['confirmPassword']
});

// ==========================================
// MEMBER SCHEMAS
// ==========================================

export const memberSchema = z.object({
 name: z.string()
 .min(1, 'Name is required')
 .min(2, 'Name must be at least 2 characters')
 .max(100, 'Name cannot exceed 100 characters')
 .trim(),
 email: emailSchema,
 phone: z.string().optional(),
 role: z.string().min(1, 'Please select a role'),
 shares: z.coerce.number().int().min(1, 'Shares must be at least 1').finite(),
 memberId: z.string().optional(),
 password: z.string().optional(),
        userRole: z.enum(['Admin', 'Administrator', 'Manager', 'Investor', 'Member', 'Audit'], { message: 'Please select a user role' }),
        createUserAccess: z.boolean()
    }).refine((data) => {
 if (data.createUserAccess && !data.password) {
 return false;
 }
 return true;
}, {
 message: 'Password is required when creating user access',
 path: ['password']
}).refine((data) => {
 if (data.password && data.password.length > 0) {
 return data.password.length >= 6;
 }
 return true;
}, {
 message: 'Password must be at least 6 characters',
 path: ['password']
});

// ==========================================
// DEPOSIT SCHEMAS
// ==========================================

export const depositSchema = z.object({
 memberId: z.string().min(1, 'Please select a member'),
 amount: positiveNumberSchema.max(1000000000, 'Amount cannot exceed ৳1,000,000,000'),
 shareNumber: positiveIntegerSchema.or(z.literal(0)),
 depositMonth: z.string().min(1, 'Please select a deposit month'),
 cashierName: z.string().min(1, 'Cashier name is required').trim(),
 fundId: z.string().min(1, 'Please select a fund'),
 depositMethod: z.enum(['Cash', 'Bank', 'Mobile Banking', 'Check', 'Other'], { message: 'Please select a deposit method' }),
 txnDate: pastDateSchema
});

// ==========================================
// EXPENSE SCHEMAS
// ==========================================

export const expenseSchema = z.object({
 memberId: z.string().min(1, 'Please select a member'),
 projectId: z.string().optional(),
 amount: positiveNumberSchema,
 category: z.string().min(1, 'Please select a category'),
 reason: z.string().min(10, 'Please provide more details (at least 10 characters)').max(1000),
 date: pastDateSchema,
 sourceFund: z.string().min(1, 'Please select a source fund')
});

// ==========================================
// PROJECT SCHEMAS
// ==========================================

export const projectSchema = z.object({
 title: z.string().min(3, 'Title must be at least 3 characters').max(200),
 category: z.string().min(1, 'Please select a category'),
 description: z.string().min(20, 'Please provide more details').max(5000),
 initialInvestment: positiveNumberSchema,
 budget: positiveNumberSchema,
 expectedRoi: z.coerce.number().min(0).max(10000),
 totalShares: positiveIntegerSchema,
 status: z.enum(['In Progress', 'Completed', 'Review']),
 health: z.enum(['Stable', 'At Risk', 'Critical']),
 startDate: dateSchema,
 completionDate: dateSchema.optional(),
 projectFundHandler: z.string().min(1, 'Fund handler is required'),
 linkedFundId: z.string().optional()
});

// ==========================================
// GOAL SCHEMA
// ==========================================

export const goalSchema = z.object({
 title: z.string().min(3, 'Title must be at least 3 characters').max(200),
 description: z.string().max(1000).optional(),
 targetAmount: positiveNumberSchema,
 currentAmount: z.coerce.number().min(0).default(0),
 deadline: dateSchema.optional(),
 status: z.enum(['In Progress', 'Achieved', 'Cancelled']),
 type: z.enum(['Savings', 'Investment', 'Other']),
 linkedProject: z.string().optional()
});

// ==========================================
// TYPE EXPORTS
// ==========================================

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type MemberFormData = z.infer<typeof memberSchema>;
export type DepositFormData = z.infer<typeof depositSchema>;
export type ExpenseFormData = z.infer<typeof expenseSchema>;
export type ProjectFormData = z.infer<typeof projectSchema>;
export type GoalFormData = z.infer<typeof goalSchema>;

// ==========================================
// HELPERS
// ==========================================

export const formatZodError = (error: z.ZodError): string => {
 const firstError = error.issues[0];
 return firstError?.message || 'Validation failed';
};

export const getFieldError = (error: z.ZodError | null, field: string): string | undefined => {
 if (!error) return undefined;
 const fieldError = error.issues.find(e => e.path.includes(field));
 return fieldError?.message;
};
