import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, transactions, memberPenalties, profitAllocations } from '@/db/schema/index';
import { eq, and, desc, count, sql, or } from 'drizzle-orm';
import { getAuthContext, requirePermission, type AuthenticatedUser } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { canViewMemberPII, maskMemberPII } from '@/lib/member-privacy';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail, optionalStringField } from '@/lib/utils/types';
import { isMemberRole } from '@/lib/member-roles';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError, LockedError } from '@/lib/utils/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantScope(tenantId: string | null, user: AuthenticatedUser): ReturnType<typeof sql> {
  // Fail closed (C5/SEV-005): a null tenant must 403 via requireTenant —
  // returning undefined here silently disabled every tenant filter.
  return sql`${members.tenantId} = ${requireTenant(tenantId, user)}`;
}

function errJson(err: unknown, fallback: string) {
  console.error('[MEMBER ID ERROR]', err);
  const e = err as { statusCode?: number; message?: string };
  return NextResponse.json(
    { success: false, message: e.message || fallback },
    { status: e.statusCode || 500 },
  );
}

// GET /api/members/[id] — member profile (uuid or MEM-XXXX code) plus recent
// deposit history for the detail sheet.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    requirePermission('MEMBERS', 'READ')(user);

    const { id } = await params;
    const db = getDb();
    const idMatch = UUID_RE.test(id) ? or(eq(members.id, id), eq(members.memberId, id)) : eq(members.memberId, id);
    const scope = tenantScope(user.tenantId, user);
    const [member] = await db
      .select()
      .from(members)
      .where(and(idMatch, scope))
      .limit(1);
    if (!member) throw new NotFoundError('Member');

    // PII policy shared with the list endpoint (lib/member-privacy.ts): the
    // detail sheet must not leak more than the list does.
    const canView = canViewMemberPII(user.role, member.userId, user.id);

    const depositScope = sql`${transactions.tenantId} = ${requireTenant(user.tenantId, user)}`;
    const deposits = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        description: transactions.description,
        referenceNumber: transactions.referenceNumber,
        date: transactions.date,
        status: transactions.status,
        depositMethod: transactions.depositMethod,
        balanceBefore: transactions.balanceBefore,
        balanceAfter: transactions.balanceAfter,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.memberId, member.id),
          eq(transactions.type, 'Deposit'),
          eq(transactions.isDeleted, false),
          depositScope,
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(20);

    return NextResponse.json({ success: true, data: { ...maskMemberPII(member, canView), deposits } });
  } catch (err: unknown) {
    return errJson(err, 'Failed to fetch member');
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATABLE_STATUS = ['active', 'inactive', 'pending', 'suspended'];

// PUT /api/members/[id] — update profile fields. Shares are fixed equity ownership units
// locked after creation, so any shares payload is rejected once transactions exist.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    const db = getDb();
    const idMatch = UUID_RE.test(id) ? or(eq(members.id, id), eq(members.memberId, id)) : eq(members.memberId, id);
    const scope = tenantScope(user.tenantId, user);
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(idMatch, scope))
      .limit(1);
    if (!existing) throw new NotFoundError('Member');

    const body = await request.json();
    const patch: Partial<typeof members.$inferInsert> = {};
    let sharesUpdated = false;
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ValidationError('Name is required');
      patch.name = name;
    }
    if (body.email !== undefined) {
      const email = normalizeEmail(String(body.email));
      if (!EMAIL_RE.test(email)) throw new ValidationError('Valid email is required');
      const [clash] = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.email, email))
        .limit(1);
      if (clash && clash.id !== existing.id) throw new ConflictError('A member with this email already exists');
      patch.email = email;
    }
    if (body.phone !== undefined) {
      // phone is NOT NULL in the schema; null (previously written as the
      // literal string "null") or empty is rejected, not coerced.
      const phone = body.phone === null ? '' : String(body.phone).trim();
      if (!phone) throw new ValidationError('Phone is required');
      if (phone.length > 50) throw new ValidationError('Phone must be at most 50 characters');
      patch.phone = phone;
    }
    if (body.role !== undefined) {
      // Same vocabulary as POST /api/members (lib/member-roles.ts), so a role
      // one of them accepts cannot be rejected by the other.
      if (!isMemberRole(body.role)) {
        throw new ValidationError(`[Field 'role', Code: invalid_role] Not a recognized member role`);
      }
      patch.role = body.role;
    }
    if (body.status !== undefined) {
      if (!UPDATABLE_STATUS.includes(String(body.status))) throw new ValidationError('Invalid status');
      patch.status = String(body.status);
    }
    if (body.avatar !== undefined) patch.avatar = body.avatar || null;
    // KYC/nominee fields go through the same length-checked coercion as POST
    // /api/members. nomineeNidOrPassport used to be missing here entirely: the
    // create route stored it, the edit route silently dropped it, so the value
    // was write-once and unfixable (and the form had no field for it at all).
    if (body.nidOrPassport !== undefined) patch.nidOrPassport = optionalStringField(body.nidOrPassport, 'NID/Passport', 100);
    if (body.fatherName !== undefined) patch.fatherName = optionalStringField(body.fatherName, "Father's name", 255);
    if (body.address !== undefined) patch.address = optionalStringField(body.address, 'Address', 500);
    if (body.nomineeName !== undefined) patch.nomineeName = optionalStringField(body.nomineeName, 'Nominee name', 255);
    if (body.nomineeRelation !== undefined) patch.nomineeRelation = optionalStringField(body.nomineeRelation, 'Nominee relation', 100);
    if (body.nomineeNidOrPassport !== undefined) patch.nomineeNidOrPassport = optionalStringField(body.nomineeNidOrPassport, 'Nominee NID/Passport', 100);
    if (body.nomineePhone !== undefined) patch.nomineePhone = optionalStringField(body.nomineePhone, 'Nominee phone', 50);
    // One-time setup: shares may only be set or corrected before the member
    // has any transaction. Afterwards they are locked. The check and the
    // update run inside one transaction with the member row locked — a
    // concurrent first deposit updates members on the same row, so the lock
    // closes the count-then-write race.
    if (body.shares !== undefined) {
      const sharesNum = Number(body.shares);
      if (!Number.isInteger(sharesNum) || sharesNum < 1) throw new ValidationError('Shares must be at least 1');
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM members WHERE id = ${existing.id} FOR UPDATE`);
        const [txnCount] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(transactions)
          .where(eq(transactions.memberId, existing.id));
        if ((txnCount?.total ?? 0) > 0) {
          throw new LockedError('Share numbers are locked once transactions exist');
        }
        await tx
          .update(members)
          .set({ shares: sharesNum, updatedAt: new Date() })
          .where(eq(members.id, existing.id));
      });
      sharesUpdated = true;
    }

    if (Object.keys(patch).length === 0 && !sharesUpdated) {
      const [current] = await db.select().from(members).where(eq(members.id, existing.id)).limit(1);
      return NextResponse.json({ success: true, data: current });
    }

    const [updated] = await db
      .update(members)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(members.id, existing.id))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: user.tenantId ?? undefined,
      action: 'UPDATE_MEMBER',
      resourceType: 'Member',
      resourceId: existing.id,
      details: { fields: body.shares !== undefined ? [...Object.keys(patch), 'shares'] : Object.keys(patch) },
    });

    return NextResponse.json({ success: true, data: updated, message: 'Member updated successfully.' });
  } catch (err: unknown) {
    return errJson(err, 'Failed to update member');
  }
}

// DELETE /api/members/[id] — blocked while non-deleted ledger entries exist.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    const db = getDb();
    const idMatch = UUID_RE.test(id) ? or(eq(members.id, id), eq(members.memberId, id)) : eq(members.memberId, id);
    const scope = tenantScope(user.tenantId, user);
    const [existing] = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(idMatch, scope))
      .limit(1);
    if (!existing) throw new NotFoundError('Member');

    // FK guards: transactions (restrict) and member_penalties /
    // profit_allocations (restrict) would make the hard DELETE fail with a
    // raw FK violation (500). Fail with a clear 400 instead. Soft-deleted
    // transactions still hold FK references, so count ALL ledger rows.
    // The three counts are independent — batch them into one round-trip
    // group; checks below preserve the original precedence.
    const [[linked], [penalties], [allocations]] = await Promise.all([
      db
        .select({ count: count() })
        .from(transactions)
        .where(eq(transactions.memberId, existing.id)),
      db
        .select({ count: count() })
        .from(memberPenalties)
        .where(eq(memberPenalties.memberId, existing.id)),
      db
        .select({ count: count() })
        .from(profitAllocations)
        .where(eq(profitAllocations.memberId, existing.id)),
    ]);

    if (Number(linked?.count ?? 0) > 0) {
      throw new ValidationError('Member has ledger history and cannot be deleted. Suspend the member instead.');
    }

    if (Number(penalties?.count ?? 0) > 0) {
      throw new ValidationError('Member has penalty records and cannot be deleted. Resolve or waive the penalties first.');
    }

    if (Number(allocations?.count ?? 0) > 0) {
      throw new ValidationError('Member has profit allocations and cannot be deleted.');
    }

    await db.delete(members).where(eq(members.id, existing.id));

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: user.tenantId ?? undefined,
      action: 'DELETE_MEMBER',
      resourceType: 'Member',
      resourceId: existing.id,
      details: { name: existing.name },
    });

    return NextResponse.json({ success: true, message: 'Member deleted successfully.' });
  } catch (err: unknown) {
    return errJson(err, 'Failed to delete member');
  }
}
