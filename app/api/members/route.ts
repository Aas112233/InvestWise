import { apiError } from '@/lib/utils/api-error';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members, projectMembers, projects } from '@/db/schema/index';
import { and, eq, sql } from 'drizzle-orm';
import { fromCents, toCents } from '@/lib/money';
import { PROJECT_MEMBER_ROLE } from '@/lib/distribution-rules';
import { getAuthContext, requirePermission } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { logAudit } from '@/lib/utils/audit';
import { normalizeEmail } from '@/lib/utils/types';
import { ConflictError, ForbiddenError, ValidationError, readJsonUnknown } from '@/lib/utils/errors';
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
    const role = d.role ?? 'Shareholder Member';
    // The exclusive Project Member category NEVER holds club shares (§3.2):
    // the historical default of 1 would silently hand it a dividend-eligible
    // club position. Its share number lives in project_members.sharesInvested.
    const isProjectMember = role === PROJECT_MEMBER_ROLE;
    const shares = isProjectMember ? 0 : (d.shares ?? 1);
    const status = d.status ?? 'active';

    const db = getDb();

    // The schema already required cap + projectId for Project Members; this is
    // the belt-and-braces re-check so a future schema relaxation can never
    // store a cap-less Project Member (deposit-cap fails closed on that).
    if (isProjectMember && (d.depositCap === null || d.depositCap === undefined || !d.projectId)) {
      throw new ValidationError('A Project Member needs both a deposit cap and one bound project');
    }
    if (isProjectMember && d.projectId) {
      const [boundProject] = await db
        .select({ id: projects.id, isLocked: projects.isLocked, projectType: projects.projectType })
        .from(projects)
        .where(and(eq(projects.id, d.projectId), eq(projects.tenantId, tenantId)))
        .limit(1);
      if (!boundProject) {
        throw new ValidationError("[Field 'projectId', Code: cross_tenant] Project does not exist in this tenant");
      }
      if (boundProject.isLocked) {
        throw new ValidationError(
          `[Field 'projectId', Code: PROJECT_LOCKED] That project is settled & closed — a ${PROJECT_MEMBER_ROLE} cannot be bound to it`,
        );
      }
      // Project types (migration 0032): only an Extra Investor deal has a Project
      // Level Member seat. Binding one to a Club Level project would create the
      // exact roster the project form is not allowed to save (§5), so the binding
      // door refuses it too — the picker filter is convenience, this is the rule.
      if (boundProject.projectType !== 'extra_investor') {
        throw new ValidationError(
          `[Field 'projectId', Code: CLUB_PROJECT_TAKES_NO_PM] That is a Club Level project, which cannot include a ${PROJECT_MEMBER_ROLE}. Pick an Extra Investor project, or switch that project's type while it still has no transactions.`,
        );
      }
    }
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
      // decimal(15,2) string built through the integer-cents path (§12) — the
      // schema already guaranteed positive and ≤2dp.
      depositCap: isProjectMember ? fromCents(toCents(String(d.depositCap))) : null,
      // A member created already inactive is an admin choice; stamp the reason
      // so the governance sweep does not treat it as a deposit hold. (Create
      // only accepts active/inactive — suspension is a governance action.)
      statusReason: status === 'inactive' ? 'ADMIN_MANUAL' : null,
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
        // Member row + its single project binding commit together: a binding
        // without its member (or the reverse) would corrupt the one-project
        // invariant's starting point. The code-clash retry wraps the whole unit.
        created = await db.transaction(async (tx) => {
          const [row] = await tx.insert(members).values({ memberId, ...insertValues }).returning();
          if (isProjectMember && d.projectId && row) {
            await tx.insert(projectMembers).values({
              projectId: d.projectId,
              memberId: row.id,
              sharesInvested: 0,
              ownershipPercentage: '0.00',
            });
          }
          return row;
        });
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
      // Create flow: after-only — `created` is the INSERT's .returning().
      after: created,
    });

    return NextResponse.json(
      { success: true, data: created, message: `${name} added successfully.` },
      { status: 201 },
    );
  } catch (err: unknown) {
    console.error('[MEMBERS POST ERROR]', err);
    const e = err as { statusCode?: number; message?: string };
    return apiError(e, 'Failed to create member');
  }
}
