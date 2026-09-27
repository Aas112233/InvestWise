import type { NextRequest } from 'next/server';
import { handleAddEarning, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleAddEarning(request);
}

export function GET() {
  return methodNotAllowed();
}
