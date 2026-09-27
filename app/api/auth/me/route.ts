import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { AuthError } from '@/lib/utils/errors';
import { normalizeRole } from '@/lib/roles';

const USER_SELECT = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  permissions: users.permissions,
  avatar: users.avatar,
  memberId: users.memberId,
  lastLogin: users.lastLogin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

function toUserResponse(row: Record<string, unknown>) {
  const permissions: Record<string, string> =
    typeof row.permissions === 'object' && row.permissions !== null
      ? (row.permissions as Record<string, string>)
      : {};

  const role = normalizeRole(row.role);

  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role,
    status: (row.status as string) ?? 'active',
    permissions,
    avatar: (row.avatar as string) ?? null,
    memberId: (row.memberId as string) ?? null,
    lastLogin: row.lastLogin instanceof Date ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;

    const db = getDb();
    const [user] = await db
      .select(USER_SELECT)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new AuthError('User not found', 'USER_NOT_FOUND');
    }

    return NextResponse.json(toUserResponse(user));
  } catch (error: any) {
    console.error('[GET PROFILE ERROR]', error);
    
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get profile', code: 'PROFILE_FAILED' },
      { status: 500 }
    );
  }
}