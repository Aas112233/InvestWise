import type { NextRequest } from 'next/server';
import { handleGetMemberDepositMonths, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

/**
 * Per-member deposit month grid for one fiscal year — the read behind the
 * single-member bulk collection. Tenant-scoped, DEPOSITS READ, rate-limited.
 */
export async function GET(request: NextRequest) {
  return handleGetMemberDepositMonths(request);
}

export function POST() {
  return methodNotAllowed();
}
