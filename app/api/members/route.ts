import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members } from '@/db/schema/index';
import { and, eq, sql } from 'drizzle-orm';
import { getAuthContext, requirePermission } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { ConflictError, ForbiddenError, readJsonUnknown } from '@/lib/utils/errors';
import { memberCreateSchema, memberFieldError } from '@/lib/member-schema';
import { handleListMembers } from '@/server/modules/members/handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleListMembers(request);
}

// Sequential member code, PER TENANT: uniqueness lives on (tenant_id,
// member_id), so one org's MEM-0007 says nothing about another's and the code
// no longer leaks a platform-wide member count. Only the strict 4-digit shape
// feeds MAX+1 — legacy random-code rows are skipped rather than breaking the
// CAST, and they can never collide with a fresh sequential code anyway.
async function generateMemberId(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<string> {
  const [row] = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${members.memberId} FROM 5) AS INTEGER)), 0)`,
    })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), sql`${members.memberId} ~ '^MEM-[0-9]{4}$'`));
  const next = Number(row?.maxNum ?? 0) + 1;
  return `MEM-${String(next).padStart(4, '0')}`;
}

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

    const parsed = memberCreateSchema.safeParse(await readJsonUnknown(request));
    if (!parsed.success) {
      return NextResponse.json(memberFieldError(parsed.error), { status: 400 });
    }
    const d = parsed.data;
    const name = d.name;
    const email = normalizeEmail(d.email);
    const phone = d.phone;
    // Absent role means the standard membership category; anything outside
    // the lib/member-roles vocabulary was rejected by the schema above.
    const role = d.role ?? 'Member';
    const shares = d.shares ?? 1;
    const status = d.status ?? 'active';

    const db = getDb();
    // Duplicate check is TENANT-scoped and ignores soft-deleted rows: the old
    // global probe confirmed to any tenant whether ANOTHER tenant held an
    // address (cross-tenant existence oracle), and a removed member's email
    // must be reusable by policy.
    const [existing] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, email), eq(members.isDeleted, false)))
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
      nidOrPassport: d.nidOrPassport,
      fatherName: d.fatherName,
      address: d.address,
      nomineeName: d.nomineeName,
      nomineeRelation: d.nomineeRelation,
      nomineeNidOrPassport: d.nomineeNidOrPassport,
      nomineePhone: d.nomineePhone,
    };

    // Concurrent creates can read the same MAX+1. Retry once by RECOMPUTING
    // (the rival's row has committed by then, so the fresh code is strictly
    // higher). A duplicate email or a persistent code clash surfaces as a clean
    // 409 — NEVER a raw 23505/500 that would leak the failed SQL. Drizzle may
    // wrap the driver error, so read code/constraint from the error, its cause,
    // and the message text.
    let memberId = await generateMemberId(db, tenantId);
    let created;
    for (let attempt = 0; ; attempt += 1) {
      try {
        [created] = await db.insert(members).values({ memberId, ...insertValues }).returning();
        break;
      } catch (e: unknown) {
        const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
        const code = err.code ?? err.cause?.code;
        const constraint = err.constraint ?? err.cause?.constraint ?? (typeof (e as { message?: string })?.message === 'string' ? (e as { message: string }).message : '');
        if (code !== '23505') throw e;
        if (typeof constraint === 'string' && constraint.includes('tenant_email')) {
          throw new ConflictError('A member with this email already exists');
        }
        if (attempt >= 1) {
          throw new ConflictError('Could not allocate a member code — please retry.');
        }
        memberId = await generateMemberId(db, tenantId);
      }
    }

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'CREATE_MEMBER',
      resourceType: 'Member',
      resourceId: created?.id,
      details: { memberId, name, email, role },
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
