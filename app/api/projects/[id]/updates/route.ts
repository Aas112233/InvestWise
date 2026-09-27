import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { projects, projectUpdates } from '@/db/schema/index';
import { eq, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to record project disbursements');
    }

    const { id } = await params;
    const body = await request.json();
    const { type, amount, description } = body;

    const numericAmount = Number(amount);
    if (!type || !['Earning', 'Expense'].includes(type) || !numericAmount || numericAmount <= 0) {
      throw new ValidationError('Valid type (Earning or Expense) and positive amount are required');
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new ValidationError('Description is required');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);

      if (!project) throw new NotFoundError('Project');

      const balanceBefore = Number(project.currentFundBalance || 0);
      const balanceAfter = type === 'Earning'
        ? balanceBefore + numericAmount
        : balanceBefore - numericAmount;

      const [updateRecord] = await tx
        .insert(projectUpdates)
        .values({
          projectId: id,
          type,
          amount: String(numericAmount),
          description: description.trim(),
          date: new Date(),
          balanceBefore: String(balanceBefore),
          balanceAfter: String(balanceAfter),
        })
        .returning();

      const projectUpdateFields: Record<string, unknown> = {
        currentFundBalance: String(balanceAfter),
        updatedAt: new Date(),
      };

      if (type === 'Earning') {
        projectUpdateFields.totalEarnings = sql<string>`(${projects.totalEarnings}::numeric + ${numericAmount})::numeric(15,2)`;
      } else {
        projectUpdateFields.totalExpenses = sql<string>`(${projects.totalExpenses}::numeric + ${numericAmount})::numeric(15,2)`;
      }

      await tx
        .update(projects)
        .set(projectUpdateFields)
        .where(eq(projects.id, id));

      return updateRecord;
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'ADD_PROJECT_UPDATE',
      resourceType: 'Project',
      resourceId: id,
      details: { type, amount: numericAmount, description },
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Project update recorded successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[PROJECT UPDATE POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record project update' },
      { status: err.statusCode || 500 }
    );
  }
}
