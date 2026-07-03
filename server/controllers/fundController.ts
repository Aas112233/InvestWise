import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { funds, transactions, systemSettings } from '../db/schema/index.js';
import { eq, and, desc, count } from 'drizzle-orm';
import cache from '../utils/cache.js';
import { normalizeCurrencyCode } from '../utils/currency.js';

// @desc Get all funds
// @route GET /api/funds
// @access Private
const getFunds = asyncHandler(async (req, res) => {
  const db = getDb();
  const { type, status } = req.query;

  // Default: if no status param, maybe show all? Or just Active?
  // User requested "Dropdown shows only ACTIVE funds". So UI will filter or ask for ?status=ACTIVE.
  // Let's just return what is asked.

  const conditions = [];
  if (type) conditions.push(eq(funds.type, type as string));
  if (status) conditions.push(eq(funds.status, status as string));

  const query = db.select().from(funds);
  const result = conditions.length > 0
    ? await query.where(and(...conditions)).orderBy(desc(funds.createdAt))
    : await query.orderBy(desc(funds.createdAt));
  res.json(result);
});

// @desc Get fund by ID
// @route GET /api/funds/:id
// @access Private
const getFundById = asyncHandler(async (req, res) => {
  const db = getDb();
  const result = await db.select().from(funds).where(eq(funds.id, req.params.id)).limit(1);

  if (result.length > 0) {
    res.json(result[0]);
  } else {
    res.status(404);
    throw new Error('Fund not found');
  }
});

// @desc Create a fund
// @route POST /api/funds
// @access Private/Admin
const createFund = asyncHandler(async (req, res) => {
  const db = getDb();
  const { name, type, description, initialBalance, handlingOfficer, accountNumber } = req.body;

  if (type === 'PROJECT') {
    res.status(400);
    throw new Error('PROJECT funds are automatically created when a Project is initialized.');
  }

  const result = await db.transaction(async (tx) => {
    const settingsResult = await tx.select().from(systemSettings).limit(1);
    const settings = settingsResult[0];
    const currencyCode = normalizeCurrencyCode(settings?.baseCurrency || '');

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
      // Create an "Opening Balance" transaction
      await tx.insert(transactions).values({
        type: 'Deposit',
        amount: String(initialBalance),
        description: `Opening Balance for ${name}`,
        fundId: fund.id,
        authorizedBy: req.user.id,
        date: new Date(),
      }).returning();

      // Update fund balance
      await tx.update(funds)
        .set({ balance: String(initialBalance) })
        .where(eq(funds.id, fund.id));
    }

    return fund;
  });

  // Invalidate funds list cache
  cache.invalidateByPrefix('funds:list');

  res.status(201).json(result);
});

// @desc Update fund (metadata only)
// @route PUT /api/funds/:id
// @access Private/Admin
const updateFund = asyncHandler(async (req, res) => {
  const db = getDb();
  const result = await db.select().from(funds).where(eq(funds.id, req.params.id)).limit(1);

  if (result.length > 0) {
    const existing = result[0];

    const [updatedFund] = await db.update(funds)
      .set({
        name: req.body.name || existing.name,
        type: req.body.type || existing.type,
        description: req.body.description !== undefined ? req.body.description : existing.description,
        status: req.body.status || existing.status,
        handlingOfficer: req.body.handlingOfficer !== undefined ? req.body.handlingOfficer : existing.handlingOfficer,
        accountNumber: req.body.accountNumber !== undefined ? req.body.accountNumber : existing.accountNumber,
      })
      .where(eq(funds.id, existing.id))
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
  const result = await db.select().from(funds).where(eq(funds.id, req.params.id)).limit(1);

  if (!result.length) {
    res.status(404);
    throw new Error('Fund not found');
  }

  const fund = result[0];

  // 1. Check Balance
  if (Number(fund.balance) > 0) {
    res.status(400);
    throw new Error('Cannot delete fund with non-zero balance. Transfer funds first.');
  }

  // 2. Check Transactions
  const [txCountResult] = await db.select({ count: count() })
    .from(transactions)
    .where(eq(transactions.fundId, req.params.id));

  const transactionCount = Number(txCountResult?.count || 0);
  if (transactionCount > 0) {
    res.status(400);
    throw new Error(`Cannot delete fund. It has ${transactionCount} linked transactions. Archive them first.`);
  }

  await db.delete(funds).where(eq(funds.id, req.params.id));

  // Invalidate funds list cache
  cache.invalidateByPrefix('funds:list');

  res.json({ message: 'Fund removed' });
});

export { getFunds, getFundById, createFund, updateFund, deleteFund };
