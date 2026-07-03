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
 transferValidation,
 dividendValidation,
 equityTransferValidation,
 bulkDepositValidation
} from '../middleware/businessValidator.js';

// Transactions - READ access to view
router.route('/transactions').get(protect, requirePermission('DEPOSITS', 'READ'), getTransactions);
router.route('/transactions/:id').delete(protect, requirePermission('EXPENSES', 'WRITE'), deleteTransaction);

// Deposits - WRITE access to create/edit
router.route('/deposits').post(protect, requirePermission('DEPOSITS', 'WRITE'), transactionValidation, addDeposit);
router.route('/deposits/bulk').post(protect, requirePermission('DEPOSITS', 'WRITE'), bulkDepositValidation, bulkAddDeposits);
router.route('/deposits/:id').put(protect, requirePermission('DEPOSITS', 'WRITE'), transactionValidation, editDeposit);
router.route('/deposits/:id/approve').put(protect, requirePermission('DEPOSITS', 'WRITE'), approveDeposit);

// Expenses - WRITE access to create/edit
router.route('/expenses').post(protect, requirePermission('EXPENSES', 'WRITE'), transactionValidation, addExpense);
router.route('/expenses/:id').put(protect, requirePermission('EXPENSES', 'WRITE'), transactionValidation, editExpense);

// Earnings - WRITE access
router.route('/earnings').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), transactionValidation, addEarning);

// Admin-only operations
router.route('/transfer').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), transferValidation, transferFunds);
router.route('/dividends').post(protect, requirePermission('DIVIDENDS', 'WRITE'), dividendValidation, distributeDividends);
router.route('/equity/transfer').post(protect, requirePermission('DIVIDENDS', 'WRITE'), equityTransferValidation, transferEquity);

// Fund Reconciliation
router.route('/funds/:id/reconcile').post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), reconcileFund);

export default router;
