import express from 'express';
const router = express.Router();
import {
 getTransactions,
 addDeposit,
 addExpense,
 addEarning,
 transferFunds,
 deleteTransaction,
 approveDeposit,
 distributeDividends,
 transferEquity,
 editDeposit,
 editExpense,
 reconcileFund,
 bulkAddDeposits
} from '../controllers/financeController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { 
 transactionValidation,
 depositValidation,
 expenseValidation,
 transferValidation,
 dividendValidation,
 equityTransferValidation
} from '../middleware/businessValidator.js';
import { financialOpLimiter } from '../middleware/rateLimiter.js';

// Transactions - READ access to view
router.route('/transactions').get(protect, requirePermission('DEPOSITS', 'READ'), getTransactions);
router.route('/transactions/:id').delete(protect, requirePermission('EXPENSES', 'WRITE'), financialOpLimiter, deleteTransaction);

// Deposits - WRITE access to create/edit
router.route('/deposits').post(protect, requirePermission('DEPOSITS', 'WRITE'), financialOpLimiter, depositValidation, addDeposit);
router.route('/deposits/bulk').post(protect, requirePermission('DEPOSITS', 'WRITE'), financialOpLimiter, bulkAddDeposits);
router.route('/deposits/:id').put(protect, requirePermission('DEPOSITS', 'WRITE'), financialOpLimiter, depositValidation, editDeposit);
router.route('/deposits/:id/approve').put(protect, requirePermission('DEPOSITS', 'WRITE'), financialOpLimiter, approveDeposit);

// Expenses - WRITE access to create/edit
router.route('/expenses').post(protect, requirePermission('EXPENSES', 'WRITE'), financialOpLimiter, expenseValidation, addExpense);
router.route('/expenses/:id').put(protect, requirePermission('EXPENSES', 'WRITE'), financialOpLimiter, editExpense);

// Earnings - WRITE access
router.route('/earnings').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), financialOpLimiter, transactionValidation, addEarning);

// Admin-only operations
router.route('/transfer').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), financialOpLimiter, transferValidation, transferFunds);
router.route('/dividends').post(protect, requirePermission('DIVIDENDS', 'WRITE'), financialOpLimiter, dividendValidation, distributeDividends);
router.route('/equity/transfer').post(protect, requirePermission('DIVIDENDS', 'WRITE'), financialOpLimiter, equityTransferValidation, transferEquity);

// Fund Reconciliation
router.route('/funds/:id/reconcile').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), financialOpLimiter, reconcileFund);

export default router;
