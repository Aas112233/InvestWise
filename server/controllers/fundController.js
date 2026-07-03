import asyncHandler from 'express-async-handler';
import cache from '../utils/cache.js';
import { normalizeCurrencyCode } from '../utils/currency.js';
import { getDb } from '../db/connection.js';
import { funds, transactions, systemSettings } from '../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';

// @desc Get all funds
// @route GET /api/funds
// @access Private
const getFunds = asyncHandler(async (req, res) => {
  const { type, status } = req.query;

  const conditions = [];
  if (type) conditions.push(eq(funds.type, type));
  if (status) conditions.push(eq(funds.status, status));

  const db = getDb();
  const result = await db.select()
    .from(funds)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(funds.createdAt));

  res.json(result);
});

// @desc Get fund by ID
// @route GET /api/funds/:id
// @access Private
const getFundById = asyncHandler(async (req, res) => {
  const db = getDb();
  const [fund] = await db.select()
    .from(funds)
    .where(eq(funds.id, req.params.id))
    .limit(1);

  if (fund) {
    res.json(fund);
  } else {
    res.status(404);
    throw new Error('Fund not found');
  }
});

// @desc Create a fund
// @route POST /api/funds
// @access Private/Admin
const createFund = asyncHandler(async (req, res) => {
  const { name, type, description, initialBalance, handlingOfficer, accountNumber } = req.body;

  if (type === 'PROJECT') {
    res.status(400);
    throw new Error('PROJECT funds are automatically created when a Project is initialized.');
  }

  const db = getDb();

  try {
    const [setting] = await db.select().from(systemSettings).limit(1);
    const currencyCode = normalizeCurrencyCode(setting?.baseCurrency);

    const result = await db.transaction(async (tx) => {
      const [fund] = await tx.insert(funds).values({
        name,
        type: type || 'OTHER',
        status: 'ACTIVE',
        balance: '0',
        currency: currencyCode,
        description,
        handlingOfficer,
        accountNumber,
      }).returning();

      if (initialBalance && Number(initialBalance) > 0) {
        await tx.insert(transactions).values({
          type: 'Deposit',
          amount: String(initialBalance),
          description: `Opening Balance for ${name}`,
          fundId: fund.id,
          authorizedBy: req.user.id,
          date: new Date(),
        });

        await tx.update(funds)
          .set({ balance: String(initialBalance) })
          .where(eq(funds.id, fund.id));
      }

      return fund;
    });

    // Invalidate funds list cache
    cache.invalidateByPrefix('funds:list');

    res.status(201).json(result);
  } catch (error) {
    res.status(400);
    throw new Error(error.message || 'Invalid fund data');
  }
});

// @desc Update fund (metadata only)
// @route PUT /api/funds/:id
// @access Private/Admin
const updateFund = asyncHandler(async (req, res) => {
  const db = getDb();
  const [fund] = await db.select()
    .from(funds)
    .where(eq(funds.id, req.params.id))
    .limit(1);

  if (fund) {
    const [updatedFund] = await db.update(funds)
      .set({
        name: req.body.name || fund.name,
        type: req.body.type || fund.type,
        description: req.body.description || fund.description,
        status: req.body.status || fund.status,
        handlingOfficer: req.body.handlingOfficer || fund.handlingOfficer,
        accountNumber: req.body.accountNumber || fund.accountNumber,
        updatedAt: new Date(),
      })
      .where(eq(funds.id, req.params.id))
      .returning();

    // Invalidate funds list cache
    cache.invalidateByPrefix('funds:list');

    res.json(updatedFund);
  } else {
    res.status(404);
    throw new Error('Fund not found');
  }
});

// @desc Delete fund
// @route DELETE /api/funds/:id
// @access Private/Admin
const deleteFund = asyncHandler(async (req, res) => {
  const db = getDb();
  const [fund] = await db.select()
    .from(funds)
    .where(eq(funds.id, req.params.id))
    .limit(1);

  if (!fund) {
    res.status(404);
    throw new Error('Fund not found');
  }

  // 1. Check Balance
  if (Number(fund.balance) > 0) {
    res.status(400);
    throw new Error('Cannot delete fund with non-zero balance. Transfer funds first.');
  }

  // 2. Check Transactions
  const [{ count: txCount }] = await db.select({ count: count() })
    .from(transactions)
    .where(eq(transactions.fundId, req.params.id));

  if (Number(txCount) > 0) {
    res.status(400);
    throw new Error(`Cannot delete fund. It has ${txCount} linked transactions. Archive them first.`);
  }

  await db.delete(funds).where(eq(funds.id, req.params.id));

  // Invalidate funds list cache
  cache.invalidateByPrefix('funds:list');

  res.json({ message: 'Fund removed' });
});

export { getFunds, getFundById, createFund, updateFund, deleteFund };
