import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, transactions, users } from '@/db/schema/index';
import { eq, and, desc, sql, or } from 'drizzle-orm';
import { getAuthContext, requirePermission, type AuthenticatedUser } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { canViewMemberPII, maskMemberPII, canViewMemberReviewData, maskMemberReviewData } from '@/lib/member-privacy';
import { memberUpdateSchema, memberFieldError } from '@/lib/member-schema';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError, LockedError, readJsonUnknown } from '@/lib/utils/errors';

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
    // Soft-deleted rows read as 404 everywhere except the audit trail — the
    // detail sheet must not resurrect a removed member.
    const [member] = await db
      .select()
      .from(members)
      .where(and(idMatch, scope, eq(members.isDeleted, false)))
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
      .orderBy(desc(transactions.createdAt), desc(transactions.date), desc(transactions.id))
      .limit(20);

    return NextResponse.json({
      success: true,
      // Review metrics follow the same rule as the directory's hidden
      // Warnings column: Admin/Manager only, list and detail in lockstep.
      data: {
        ...maskMemberReviewData(maskMemberPII(member, canView), canViewMemberReviewData(user.role)),
        deposits,
      },
    });
  } catch (err: unknown) {
    return errJson(err, 'Failed to fetch member');
  }
}

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
      // Full row (not an id projection): the same single query doubles as the
      // audit before-snapshot — no extra round trip.
      .select()
      .from(members)
      .where(and(idMatch, scope, eq(members.isDeleted, false)))
      .limit(1);
    if (!existing) throw new NotFoundError('Member');

    // Zod body validation shared with POST /api/members (lib/member-schema.ts)
    // — same vocabulary, same length limits on both doors (§11 field errors).
    const parsed = memberUpdateSchema.safeParse(await readJsonUnknown(request));
    if (!parsed.success) {
      return NextResponse.json(memberFieldError(parsed.error), { status: 400 });
    }
    const d = parsed.data;

    const patch: Partial<typeof members.$inferInsert> = {};
    let sharesUpdated = false;
    if (d.name !== undefined) patch.name = d.name;
    if (d.email !== undefined) {
      const email = normalizeEmail(d.email);
      // TENANT-scoped, live-rows-only duplicate check: the old global probe
      // confirmed whether ANOTHER tenant holds the address, and a
      // soft-deleted member's email is free again.
      const [clash] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, requireTenant(user.tenantId, user)), eq(members.email, email), eq(members.isDeleted, false)))
        .limit(1);
      if (clash && clash.id !== existing.id) throw new ConflictError('A member with this email already exists');
      patch.email = email;
    }
    if (d.phone !== undefined) patch.phone = d.phone;
    if (d.role !== undefined) patch.role = d.role;
    if (d.status !== undefined) {
      patch.status = d.status;
      // A status set by hand from the directory is an admin decision, never a
      // deposit hold. Stamp the reason so the governance sweep leaves an
      // inactive/suspended member alone, and clear it for active/pending so a
      // live member never carries a stale cause.
      patch.statusReason = d.status === 'inactive' || d.status === 'suspended' ? 'ADMIN_MANUAL' : null;
    }
    if (d.avatar !== undefined) patch.avatar = d.avatar || null;
    // KYC/nominee fields carry the same length-checked coercion as POST
    // /api/members. nomineeNidOrPassport used to be missing here entirely: the
    // create route stored it, the edit route silently dropped it, so the value
    // was write-once and unfixable.
    if (d.nidOrPassport !== undefined) patch.nidOrPassport = d.nidOrPassport;
    if (d.fatherName !== undefined) patch.fatherName = d.fatherName;
    if (d.address !== undefined) patch.address = d.address;
    if (d.nomineeName !== undefined) patch.nomineeName = d.nomineeName;
    if (d.nomineeRelation !== undefined) patch.nomineeRelation = d.nomineeRelation;
    if (d.nomineeNidOrPassport !== undefined) patch.nomineeNidOrPassport = d.nomineeNidOrPassport;
    if (d.nomineePhone !== undefined) patch.nomineePhone = d.nomineePhone;
    // One-time setup: shares may only be set or corrected before the member
    // has any transaction. Afterwards they are locked. The check and the
    // update run inside one transaction with the member row locked — a
    // concurrent first deposit updates members on the same row, so the lock
    // closes the count-then-write race.
    if (d.shares !== undefined) {
      const sharesNum = d.shares;
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
      details: { fields: d.shares !== undefined ? [...Object.keys(patch), 'shares'] : Object.keys(patch) },
      // Zero extra queries: `existing` was fetched for the uniqueness guards
      // above; `updated` is the UPDATE's .returning() row.
      before: existing,
      after: updated,
    });

    return NextResponse.json({ success: true, data: updated, message: 'Member updated successfully.' });
  } catch (err: unknown) {
    return errJson(err, 'Failed to update member');
  }
}

// DELETE /api/members/[id] — SOFT delete (§12, same pattern as transactions).
// The row survives: ledger history, meeting attendance, project membership and
// arrears keep their FK references intact. The old hard delete silently
// cascaded all of that away (ON DELETE CASCADE) whenever a member happened to
// have no completed transactions — history vanished with no guard or warning.
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
      .select({
        id: members.id,
        name: members.name,
        memberId: members.memberId,
        userId: members.userId,
      })
      .from(members)
      .where(and(idMatch, scope, eq(members.isDeleted, false)))
      .limit(1);
    if (!existing) throw new NotFoundError('Member');

    // HARD RULE: a member with ANY linked transaction can never leave the
    // directory — the ledger is immutable financial history and every row
    // (including soft-deleted ones) keeps its member reference. Suspension is
    // the alternative. Only a transaction-free member may be removed.
    const [txnCount] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.memberId, existing.id));
    if ((txnCount?.total ?? 0) > 0) {
      throw new ValidationError(
        `${existing.name} has ${txnCount?.total ?? 0} linked transaction(s) and cannot be deleted. Suspend the member instead.`,
      );
    }

    // Optional reason (audit trail). DELETE may arrive with no body at all.
    let reason: string | null = null;
    try {
      const raw = await request.text();
      if (raw) {
        const b = JSON.parse(raw) as { reason?: unknown };
        if (typeof b?.reason === 'string' && b.reason.trim()) reason = b.reason.trim().slice(0, 500);
      }
    } catch {
      // A bodyless or malformed delete is still a valid removal — the reason
      // is best-effort, the audit row records the actor either way.
    }

    // Guard: a member whose code is claimed by a login cannot disappear from
    // under it — users.member_id is an un-FK'd varchar, so a hard removal here
    // would leave the account pointing at a ghost identity.
    const linkConds = [eq(users.memberId, existing.memberId)];
    if (existing.userId) linkConds.push(eq(users.id, existing.userId));
    const [linkedLogin] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(or(...linkConds))
      .limit(1);
    if (linkedLogin) {
      throw new ValidationError(
        `${existing.name} is linked to the login ${linkedLogin.email}. Remove the login access first, or suspend the member instead.`,
      );
    }

    await db
      .update(members)
      .set({
        isDeleted: true,
        deletedBy: user.id,
        deletionReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(members.id, existing.id));

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: user.tenantId ?? undefined,
      action: 'DELETE_MEMBER',
      resourceType: 'Member',
      resourceId: existing.id,
      details: { name: existing.name, reason },
      // Soft delete: snapshot the row as it stood before the tombstone flags.
      before: existing,
      after: { isDeleted: true, deletedBy: user.id, deletionReason: reason },
    });

    return NextResponse.json({
      success: true,
      message: 'Member removed from the directory. Attendance and penalty records were retained for audit.',
    });
  } catch (err: unknown) {
    return errJson(err, 'Failed to delete member');
  }
}
