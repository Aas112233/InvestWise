import type { NextRequest } from 'next/server';
import { handleAddDeposit, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleAddDeposit(request);
}

export function GET() {
  return methodNotAllowed();
}
