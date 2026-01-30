
// @desc    Edit a deposit
// @route   PUT /api/finance/deposits/:id
// @access  Private (Admin)
const editDeposit = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { memberId, amount, fundId, description, date, shareNumber, cashierName } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transaction = await Transaction.findById(id).session(session);
        if (!transaction) {
            res.status(404);
            throw new Error('Transaction not found');
        }

        if (transaction.type !== 'Deposit') {
            res.status(400);
            throw new Error('Transaction is not a deposit');
        }

        const oldAmount = transaction.amount;
        const oldFundId = transaction.fundId;
        const oldMemberId = transaction.memberId;
        const oldShareImpact = Math.floor(oldAmount / 1000); // Approximation from addDeposit logic

        const newAmount = parseInt(amount);
        const newShareImpact = parseInt(shareNumber);

        // 1. Revert Old Impact
        if (transaction.status === 'Success' || transaction.status === 'Completed') {
            // Revert Fund
            const oldFund = await Fund.findById(oldFundId).session(session);
            if (oldFund) {
                oldFund.balance -= oldAmount;
                await oldFund.save({ session });
            }

            // Revert Member
            const oldMember = await Member.findById(oldMemberId).session(session);
            if (oldMember) {
                oldMember.totalContributed -= oldAmount;
                oldMember.shares -= oldShareImpact;
                await oldMember.save({ session });
            }
        }

        // 2. Apply New Impact
        // Find New Fund (or same)
        const newFund = await Fund.findById(fundId).session(session);
        if (!newFund) throw new Error('Target fund not found');

        newFund.balance += newAmount;
        await newFund.save({ session });

        // Find New Member (or same)
        const newMember = await Member.findById(memberId).session(session);
        if (!newMember) throw new Error('Target member not found');

        newMember.totalContributed += newAmount;
        newMember.shares += newShareImpact;
        await newMember.save({ session });

        // 3. Update Transaction Record
        transaction.amount = newAmount;
        transaction.fundId = fundId;
        transaction.memberId = memberId;
        transaction.description = description;
        transaction.date = date;
        transaction.handlingOfficer = cashierName;
        // transaction.shareNumber -- Transaction schema might not have this, but Member does.
        await transaction.save({ session });

        // 4. Audit Log (System Activity)
        await AuditLog.create([{
            user: req.user._id,
            userName: req.user.name,
            action: 'EDIT_DEPOSIT',
            resourceType: 'Transaction',
            resourceId: transaction._id,
            details: {
                message: `Edited deposit #${transaction._id}`,
                previous: { amount: oldAmount, fundId: oldFundId, memberId: oldMemberId },
                current: { amount: newAmount, fundId, memberId }
            },
            ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        }], { session });

        await session.commitTransaction();
        await recalculateAllStats();
        res.json(transaction);

    } catch (error) {
        await session.abortTransaction();
        res.status(400);
        throw new Error(error.message || 'Edit deposit failed');
    } finally {
        session.endSession();
    }
});
