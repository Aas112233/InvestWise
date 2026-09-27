import type { NextRequest } from 'next/server';
import { handleListProjects } from '@/server/modules/members/handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleListProjects(request);
}
