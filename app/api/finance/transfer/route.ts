import type { NextRequest } from 'next/server';
import { handleTransferFunds, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleTransferFunds(request);
}

export function GET() {
  return methodNotAllowed();
}
