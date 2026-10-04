import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members } from '@/db/schema/index';
import { eq, sql } from 'drizzle-orm';
import { getAuthContext, requirePermission } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail, optionalStringField } from '@/lib/utils/types';
import { ValidationError, ConflictError, ForbiddenError } from '@/lib/utils/errors';
import { handleListMembers } from '@/server/modules/members/handlers';
import { isMemberRole } from '@/lib/member-roles';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleListMembers(request);
}

async function generateMemberId(db: ReturnType<typeof getDb>): Promise<string> {
  const [row] = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${members.memberId} FROM 5) AS INTEGER)), 0)`,
    })
    .from(members)
    .where(sql`${members.memberId} ~ '^MEM-[0-9]{4}$'`);
  const next = Number(row?.maxNum ?? 0) + 1;
  return `MEM-${String(next).padStart(4, '0')}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/members — create a member (server generates the MEM-XXXX code;
// shares are set once at creation and locked afterwards).
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    try {
      requirePermission('MEMBERS', 'WRITE')(user);
    } catch {
      throw new ForbiddenError('Write permission required for: MEMBERS');
    }
    // §6 fail-closed: platform operators (null tenant) must use /api/admin —
    // an insert without tenantId would create an orphan row no tenant can see.
    const tenantId = requireTenant(user.tenantId, user);

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
    // Absent role means the standard category. A role that is present but
    // unrecognized is rejected instead of being quietly rewritten to 'Member' —
    // that coercion used to overwrite seeded categories (Board Member, Founding
    // Member) with no signal to the client (AGENTS.md §11).
    let role = 'Member';
    if (body.role !== undefined && body.role !== null && body.role !== '') {
      if (!isMemberRole(body.role)) {
        throw new ValidationError(`[Field 'role', Code: invalid_role] Not a recognized member role`);
      }
      role = body.role;
    }
    const shares = body.shares === undefined ? 1 : Number(body.shares);
    const status = body.status === 'inactive' ? 'inactive' : 'active';
    // KYC/nominee fields — the member form sends these; they were silently
    // dropped in an earlier migration (Express validation accepted them).
    // Length limits are shared with PUT /api/members/[id], so a value that
    // creates cleanly can never be rejected (or truncated) on the first edit.
    const nidOrPassport = optionalStringField(body.nidOrPassport, 'NID/Passport', 100);
    const fatherName = optionalStringField(body.fatherName, "Father's name", 255);
    const address = optionalStringField(body.address, 'Address', 500);
    const nomineeName = optionalStringField(body.nomineeName, 'Nominee name', 255);
    const nomineeRelation = optionalStringField(body.nomineeRelation, 'Nominee relation', 100);
    const nomineeNidOrPassport = optionalStringField(body.nomineeNidOrPassport, 'Nominee NID/Passport', 100);
    const nomineePhone = optionalStringField(body.nomineePhone, 'Nominee phone', 50);

    if (!name) throw new ValidationError('Name is required');
    if (!EMAIL_RE.test(email)) throw new ValidationError('Valid email is required');
    if (!phone) throw new ValidationError('Phone is required');
    if (phone.length > 50) throw new ValidationError('Phone must be at most 50 characters');
    if (!Number.isInteger(shares) || shares < 1) throw new ValidationError('Shares must be at least 1');

    const db = getDb();
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.email, email))
      .limit(1);
    if (existing) throw new ConflictError('A member with this email already exists');

    const insertValues = {
      tenantId,
      name,
      email,
      phone,
      role,
      shares,
      status,
      nidOrPassport,
      fatherName,
      address,
      nomineeName,
      nomineeRelation,
      nomineeNidOrPassport,
      nomineePhone,
    };

    let memberId = await generateMemberId(db);
    let created;
    try {
      [created] = await db
        .insert(members)
        .values({ memberId, ...insertValues })
        .returning();
    } catch (e: unknown) {
      // Unique violation on memberId under concurrency — retry once with a random code.
      const code = (e as { code?: string })?.code;
      if (code !== '23505') throw e;
      memberId = `MEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      [created] = await db
        .insert(members)
        .values({ memberId, ...insertValues })
        .returning();
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'CREATE_MEMBER',
      resourceType: 'Member',
      resourceId: created?.id,
      details: { memberId, name, email },
    });

    return NextResponse.json(
      { success: true, data: created, message: `${name} added successfully.` },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[MEMBERS POST ERROR]', err);
    const e = err as { statusCode?: number; message?: string };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to create member' },
      { status: e.statusCode || 500 },
    );
  }
}
