import type { NextRequest } from 'next/server';
import { handleDeleteTransaction, methodNotAllowed } from '@/server/modules/finance/handlers';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDeleteTransaction(request, id);
}

export function GET() {
  return methodNotAllowed();
}
