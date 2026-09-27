import type { NextRequest } from 'next/server';
import { handleAddExpense, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleAddExpense(request);
}

export function GET() {
  return methodNotAllowed();
}
