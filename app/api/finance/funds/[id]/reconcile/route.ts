import type { NextRequest } from 'next/server';
import { handleReconcileFund, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleReconcileFund(request, id);
}

export function GET() {
  return methodNotAllowed();
}
