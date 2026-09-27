import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { funds, transactions, systemSettings } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check write permission for FUNDS_MANAGEMENT
    if (!hasScreenPermission(user, 'FUNDS_MANAGEMENT', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: FUNDS_MANAGEMENT');
    }

    const body = await request.json();
    const {
      fromFundId,
      toFundId,
      amount,
      description,
      referenceNumber,
    } = body;

    // Validate required fields
    if (!fromFundId || !toFundId) {
      throw new ValidationError('fromFundId and toFundId are required');
    }

    if (fromFundId === toFundId) {
      throw new ValidationError('Source and destination funds cannot be the same');
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      throw new ValidationError('Transfer amount must be a positive number');
    }

    // Validate 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
      throw new ValidationError('Amount must have at most 2 decimal places');
    }

    const formattedAmount = transferAmount.toFixed(2);
    const refNumber = referenceNumber || `TRF-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const db = getDb();

    // Check for duplicate reference number (idempotency)
    const existingTransfer = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.referenceNumber, refNumber), eq(transactions.isDeleted, false)))
      .limit(1);

    if (existingTransfer.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    // Get both funds with tenant isolation
    const [fromFund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, fromFundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    const [toFund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, toFundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!fromFund) {
      throw new NotFoundError('Source fund');
    }

    if (!toFund) {
      throw new NotFoundError('Destination fund');
    }

    // Check if source fund has sufficient balance above minimum
    const fromBalance = parseFloat(fromFund.balance);
    const fromMinBalance = parseFloat(fromFund.minimumBalance || '0');
    const availableBalance = fromBalance - fromMinBalance;

    if (availableBalance < transferAmount) {
      throw new ValidationError(
        `Insufficient available balance in source fund. Available: ${availableBalance.toFixed(2)}, Required: ${formattedAmount}`
      );
    }

    // Check if funds are in compatible currencies
    if (fromFund.currency !== toFund.currency) {
      throw new ValidationError('Cannot transfer between funds with different currencies');
    }

    // Check share value lock status
    const [settings] = await db.select().from(systemSettings).limit(1);
    if (settings?.isShareValueLocked) {
      // Allow transfers even when share value is locked, but log it
      console.log('[FUND TRANSFER] Share value is locked, transfer proceeding');
    }

    // Execute atomic transfer transaction
    await db.transaction(async (tx) => {
      const now = new Date();
      
      // Debit source fund
      const newFromBalance = (fromBalance - transferAmount).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newFromBalance, updatedAt: now })
        .where(eq(funds.id, fromFundId));

      // Credit destination fund
      const toBalance = parseFloat(toFund.balance);
      const newToBalance = (toBalance + transferAmount).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newToBalance, updatedAt: now })
        .where(eq(funds.id, toFundId));

      // Create Transfer Out transaction
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Transfer Out',
        amount: formattedAmount,
        description: description || `Transfer to ${toFund.name}`,
        category: 'Fund Transfer',
        referenceNumber: `${refNumber}-OUT`,
        date: now,
        status: 'Completed',
        fundId: fromFundId,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: fromFund.balance,
        balanceAfter: newFromBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });

      // Create Transfer In transaction
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Transfer In',
        amount: formattedAmount,
        description: description || `Transfer from ${fromFund.name}`,
        category: 'Fund Transfer',
        referenceNumber: `${refNumber}-IN`,
        date: now,
        status: 'Completed',
        fundId: toFundId,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: toFund.balance,
        balanceAfter: newToBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'FUND_TRANSFER',
      resourceType: 'Fund',
      resourceId: fromFundId,
      details: {
        fromFund: fromFund.name,
        toFund: toFund.name,
        amount: formattedAmount,
        currency: fromFund.currency,
        referenceNumber: refNumber,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        fromFund: { id: fromFund.id, name: fromFund.name, newBalance: (parseFloat(fromFund.balance) - transferAmount).toFixed(2) },
        toFund: { id: toFund.id, name: toFund.name, newBalance: (parseFloat(toFund.balance) + transferAmount).toFixed(2) },
        amount: formattedAmount,
        currency: fromFund.currency,
      },
      message: 'Fund transfer completed successfully',
    });
  } catch (err: any) {
    console.error('[FUND TRANSFER ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to transfer funds' },
      { status: err.statusCode || 500 }
    );
  }
}