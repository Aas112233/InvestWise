import type { NextRequest } from 'next/server';
import { handleGetTransactions, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleGetTransactions(request);
}

export function POST() {
  return methodNotAllowed();
}
