import type { NextRequest } from 'next/server';
import { handleApproveDeposit, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleApproveDeposit(request, id);
}

export function GET() {
  return methodNotAllowed();
}
