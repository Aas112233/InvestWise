import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  depositSchema,
  expenseSchema,
  earningSchema,
  transferSchema,
  dividendSchema,
  equityTransferSchema,
  bulkDepositSchema,
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
  getShareConsistencyHandler,
  recalculateSharesHandler,
} from './controller.js';

const router = Router();

// All routes require authentication
router.use(protect);

// ── Transactions ──────────────────────────────────────────────────────────
router.get('/transactions', requirePermission('DEPOSITS', 'READ'), getTransactions);
router.delete('/transactions/:id', requirePermission('EXPENSES', 'WRITE'), deleteTransaction);

// ── Deposits ──────────────────────────────────────────────────────────────
router.post('/deposits', requirePermission('DEPOSITS', 'WRITE'), validate(depositSchema), addDeposit);
router.post('/deposits/bulk', requirePermission('DEPOSITS', 'WRITE'), validate(bulkDepositSchema), bulkAddDeposits);
router.put('/deposits/:id', requirePermission('DEPOSITS', 'WRITE'), validate(depositSchema), editDeposit);
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

// ── Withdrawal Governance ─────────────────────────────────────────────────
router.post('/withdrawal/validate', requirePermission('FUNDS_MANAGEMENT', 'READ'), validateWithdrawalHandler);
router.get('/withdrawal/settlement/:memberId', requirePermission('FUNDS_MANAGEMENT', 'READ'), calculateExitSettlementHandler);

// ── Share Consistency ─────────────────────────────────────────────────────
router.get('/share-consistency', requirePermission('ANALYSIS', 'READ'), getShareConsistencyHandler);
router.post('/recalculate-shares', requirePermission('SETTINGS', 'WRITE'), recalculateSharesHandler);

export default router;
