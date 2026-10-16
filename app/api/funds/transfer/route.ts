import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireTenant, errorResponse, type SessionUser } from '@/server/middleware/api';
import * as finance from '@/server/modules/finance/service';
import { AppError } from '@/server/shared/errors';

export const dynamic = 'force-dynamic';

/** Parse the JSON body; a malformed/non-object body is a 400, never a 500. */
async function readBody(request: NextRequest): Promise<any> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('Request body must be valid JSON', 400, 'INVALID_JSON');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('Request body must be a JSON object', 400, 'INVALID_BODY');
  }
  return raw;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    requireTenant(user);

    const body = await readBody(request);
    const sourceFundId = body.sourceFundId || body.fromFundId;
    const targetFundId = body.targetFundId || body.toFundId;
    const amount = body.amount;
    const description = body.description;
    const referenceNumber = body.referenceNumber;

    if (!sourceFundId || !targetFundId) {
      throw new AppError('sourceFundId (or fromFundId) and targetFundId (or toFundId) are required', 400, 'VALIDATION_ERROR');
    }

    if (sourceFundId === targetFundId) {
      throw new AppError('Source and destination funds cannot be the same. Choose two different funds.', 400, 'SAME_FUND');
    }

    const result = await finance.transferFunds(
      {
        sourceFundId,
        targetFundId,
        amount,
        description,
        referenceNumber,
      },
      user as SessionUser,
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Fund transfer completed successfully',
      },
      { status: 201 },
    );
  } catch (err: any) {
    return errorResponse(err);
  }
}