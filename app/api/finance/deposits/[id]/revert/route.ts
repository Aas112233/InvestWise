import type { NextRequest } from 'next/server';
import { handleRevertDeposit, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleRevertDeposit(request, id);
}

export function GET() {
  return methodNotAllowed();
}
