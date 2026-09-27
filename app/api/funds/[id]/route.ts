import type { NextRequest } from 'next/server';
import { handleUpdateFund } from '@/server/modules/members/handlers';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleUpdateFund(request, id);
}
