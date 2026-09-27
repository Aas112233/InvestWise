import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { AppError, AuthError, ForbiddenError, ConflictError, ValidationError } from '@/lib/utils/errors';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole, isSuperAdminRole } from '@/lib/roles';

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

const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

function getDefaultPermissions(role: string): Record<string, string> {
  const perms: Record<string, string> = {};
  const normalized = normalizeRole(role);
  if (normalized === 'SuperAdmin' || normalized === 'Admin') {
    for (const screen of ALL_SCREENS) perms[screen] = 'WRITE';
  } else if (normalized === 'Manager') {
    for (const screen of ALL_SCREENS) perms[screen] = 'READ';
  }
  return perms;
}

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

export async function POST(request: NextRequest) {
  try {
    const { user: authUser, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    const userId = authUser.id;
    const callerRole = normalizeRole(authUser.role);

    // Only tenant Admins and platform operators may create users.
    if (callerRole !== 'Admin' && !isSuperAdminRole(callerRole)) {
      throw new ForbiddenError('Admin access required');
    }

    const body = await request.json();
    const { name, email, password, role, memberId, permissions } = body;

    // Validation
    if (!name || name.length < 2) {
      throw new ValidationError('Name must be at least 2 characters');
    }
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!password) {
      throw new ValidationError('Password is required');
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new ValidationError(passwordValidation.message || 'Invalid password');
    }

    const normalizedEmail = normalizeEmail(email);
    const db = getDb();

    // Check for existing user
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    const hashed = await hashPassword(password);

    // Platform operators are provisioned via seed/allowlist only — creating a
    // SuperAdmin through this endpoint would be privilege escalation.
    const newRole = normalizeRole(role);
    if (isSuperAdminRole(newRole)) {
      throw new ForbiddenError('SuperAdmin accounts cannot be created here');
    }

    const [created] = await db
      .insert(users)
      .values({
        name,
        email: normalizedEmail,
        password: hashed,
        role: newRole,
        memberId: memberId || null,
        permissions: (permissions && Object.keys(permissions).length > 0
          ? permissions
          : getDefaultPermissions(newRole)) as Record<string, string>,
      })
      .returning(USER_SELECT);

    if (!created) {
      throw new AppError('Failed to create user', 500);
    }

    await logAudit({
      action: 'CREATE_USER',
      resourceType: 'User',
      resourceId: created.id,
      details: { createdBy: userId, email: normalizedEmail, role: newRole },
      status: 'SUCCESS',
    });

    return NextResponse.json(
      {
        success: true,
        data: { user: toUserResponse(created) },
        message: 'User created successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[REGISTER USER ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError || error instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'User registration failed', code: 'REGISTRATION_FAILED' },
      { status: 500 }
    );
  }
}