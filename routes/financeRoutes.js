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
    transferEquity
} from '../controllers/financeController.js';
import { protect, admin, managerOrAdmin } from '../middleware/authMiddleware.js';
import { transactionValidation } from '../middleware/businessValidator.js';

router.route('/transactions').get(protect, managerOrAdmin, getTransactions);
router.route('/transactions/:id').delete(protect, admin, deleteTransaction);
router.route('/deposits').post(protect, transactionValidation, addDeposit);
router.route('/deposits/:id/approve').put(protect, admin, approveDeposit);
router.route('/expenses').post(protect, managerOrAdmin, transactionValidation, addExpense);
router.route('/earnings').post(protect, managerOrAdmin, transactionValidation, addEarning);
router.route('/transfer').post(protect, admin, transferFunds);
router.route('/dividends').post(protect, admin, distributeDividends);
router.route('/equity/transfer').post(protect, admin, transferEquity);

export default router;
