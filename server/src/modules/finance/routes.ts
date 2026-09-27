import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission, requireDepositWritePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  depositSchema,
  expenseSchema,
  earningSchema,
  transferSchema,
  dividendSchema,
  equityTransferSchema,
  bulkDepositSchema,
  executeWithdrawalSchema,
  executeExitSettlementSchema,
} from './validation.js';
import {
  getTransactions,
  addDeposit,
  editDeposit,
  approveDeposit,
  addExpense,
  editExpense,
  addEarning,
  deleteTransaction,
  transferFunds,
  distributeDividends,
  transferEquity,
  reconcileFund,
  bulkAddDeposits,
  validateWithdrawalHandler,
  calculateExitSettlementHandler,
  executeWithdrawalHandler,
  executeExitSettlementHandler,
  getShareConsistencyHandler,
  recalculateSharesHandler,
} from './controller.js';

const router = Router();

// All routes require authentication
router.use(protect);

// ── Transactions ──────────────────────────────────────────────────────────
router.get('/transactions', requireAnyPermission(['TRANSACTIONS', 'DEPOSITS', 'REQUEST_DEPOSIT'], 'READ'), getTransactions);
router.delete('/transactions/:id', requireAnyPermission(['TRANSACTIONS', 'DEPOSITS', 'REQUEST_DEPOSIT'], 'WRITE'), deleteTransaction);

// ── Deposits ──────────────────────────────────────────────────────────────
router.post('/deposits', requireDepositWritePermission, validate(depositSchema), addDeposit);
router.post('/deposits/bulk', requirePermission('DEPOSITS', 'WRITE'), validate(bulkDepositSchema), bulkAddDeposits);
router.put('/deposits/:id', requireDepositWritePermission, validate(depositSchema), editDeposit);
router.put('/deposits/:id/approve', requirePermission('DEPOSITS', 'WRITE'), approveDeposit);

// ── Expenses ──────────────────────────────────────────────────────────────
router.post('/expenses', requirePermission('EXPENSES', 'WRITE'), validate(expenseSchema), addExpense);
router.put('/expenses/:id', requirePermission('EXPENSES', 'WRITE'), validate(expenseSchema), editExpense);

// ── Earnings ──────────────────────────────────────────────────────────────
router.post('/earnings', requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(earningSchema), addEarning);

// ── Transfers ─────────────────────────────────────────────────────────────
router.post('/transfer', requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(transferSchema), transferFunds);

// ── Dividends ─────────────────────────────────────────────────────────────
router.post('/dividends', requirePermission('DIVIDENDS', 'WRITE'), validate(dividendSchema), distributeDividends);

// ── Equity Transfer ───────────────────────────────────────────────────────
router.post('/equity/transfer', requirePermission('DIVIDENDS', 'WRITE'), validate(equityTransferSchema), transferEquity);

// ── Fund Reconciliation ───────────────────────────────────────────────────
router.post('/funds/:id/reconcile', requirePermission('FUNDS_MANAGEMENT', 'WRITE'), reconcileFund);

// ── Withdrawal Governance & Execution ─────────────────────────────────────
router.post('/withdrawal/validate', requirePermission('FUNDS_MANAGEMENT', 'READ'), validateWithdrawalHandler);
router.get('/withdrawal/settlement/:memberId', requirePermission('FUNDS_MANAGEMENT', 'READ'), calculateExitSettlementHandler);
router.post('/withdrawal/execute', requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(executeWithdrawalSchema), executeWithdrawalHandler);
router.post('/withdrawal/settlement/:memberId/execute', requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(executeExitSettlementSchema), executeExitSettlementHandler);

// ── Share Consistency ─────────────────────────────────────────────────────
router.get('/share-consistency', requirePermission('ANALYSIS', 'READ'), getShareConsistencyHandler);
router.post('/recalculate-shares', requirePermission('SETTINGS', 'WRITE'), recalculateSharesHandler);

export default router;
