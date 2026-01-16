import asyncHandler from 'express-async-handler';
import Fund from '../models/Fund.js';
import Transaction from '../models/Transaction.js';

// @desc    Get all funds
// @route   GET /api/funds
// @access  Private
// @desc    Get all funds
// @route   GET /api/funds
// @access  Private
const getFunds = asyncHandler(async (req, res) => {
    const { type, status } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    // Default: if no status param, maybe show all? Or just Active?
    // User requested "Dropdown shows only ACTIVE funds". So UI will filter or ask for ?status=ACTIVE.
    // Let's just return what is asked.

    const funds = await Fund.find(filter).sort({ createdAt: -1 });
    res.json(funds);
});

// @desc    Get fund by ID
// @route   GET /api/funds/:id
// @access  Private
const getFundById = asyncHandler(async (req, res) => {
    const fund = await Fund.findById(req.params.id);
    if (fund) {
        res.json(fund);
    } else {
        res.status(404);
        throw new Error('Fund not found');
    }
});

// @desc    Create a fund
// @route   POST /api/funds
// @access  Private/Admin
const createFund = asyncHandler(async (req, res) => {
    const { name, type, description, initialBalance, handlingOfficer } = req.body;

    if (type === 'PROJECT') {
        res.status(400);
        throw new Error('PROJECT funds are automatically created when a Project is initialized.');
    }

    const fund = await Fund.create({
        name,
        type: type || 'OTHER',
        status: 'ACTIVE',
        balance: 0, // Balance is 0 initially. Use Opening Balance transaction if needed.
        description,
        handlingOfficer,
    });

    if (initialBalance && initialBalance > 0) {
        // Option 1: Create an "Opening Balance" transaction
        // user requirement: "optional openingBalance (but should be handled via ledger transaction)"
        await Transaction.create({
            type: 'Deposit',
            amount: initialBalance,
            description: `Opening Balance for ${name}`,
            fundId: fund._id,
            authorizedBy: req.user._id,
            date: Date.now()
        });

        fund.balance = initialBalance;
        await fund.save();
    }

    if (fund) {
        res.status(201).json(fund);
    } else {
        res.status(400);
        throw new Error('Invalid fund data');
    }
});

// @desc    Update fund (metadata only)
// @route   PUT /api/funds/:id
// @access  Private/Admin
const updateFund = asyncHandler(async (req, res) => {
    const fund = await Fund.findById(req.params.id);

    if (fund) {
        fund.name = req.body.name || fund.name;
        fund.type = req.body.type || fund.type;
        fund.description = req.body.description || fund.description;
        fund.status = req.body.status || fund.status;
        fund.handlingOfficer = req.body.handlingOfficer || fund.handlingOfficer;

        // Remove direct balance edit based on requirements
        // if (req.body.balance) ... NO

        const updatedFund = await fund.save();
        res.json(updatedFund);
    } else {
        res.status(404);
        throw new Error('Fund not found');
    }
});

// @desc    Delete fund
// @route   DELETE /api/funds/:id
// @access  Private/Admin
const deleteFund = asyncHandler(async (req, res) => {
    const fund = await Fund.findById(req.params.id);

    if (!fund) {
        res.status(404);
        throw new Error('Fund not found');
    }

    // 1. Check Balance
    if (fund.balance > 0) {
        res.status(400);
        throw new Error('Cannot delete fund with non-zero balance. Transfer funds first.');
    }

    // 2. Check Transactions
    const transactionCount = await Transaction.countDocuments({ fundId: req.params.id });
    if (transactionCount > 0) {
        res.status(400);
        throw new Error(`Cannot delete fund. It has ${transactionCount} linked transactions. Archive them first.`);
    }

    await fund.deleteOne();
    res.json({ message: 'Fund removed' });
});

export { getFunds, getFundById, createFund, updateFund, deleteFund };
