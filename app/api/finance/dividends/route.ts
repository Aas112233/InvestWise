import type { NextRequest } from 'next/server';
import { handleDistributeDividends, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleDistributeDividends(request);
}

export function GET() {
  return methodNotAllowed();
}
