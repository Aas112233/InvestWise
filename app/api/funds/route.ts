import type { NextRequest } from 'next/server';
import { handleListFunds, handleCreateFund } from '@/server/modules/members/handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleListFunds(request);
}

export async function POST(request: NextRequest) {
  return handleCreateFund(request);
}
