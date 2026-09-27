import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { users } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '@/lib/utils/types';
import { logAudit } from '@/lib/utils/audit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = body.email;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, message: 'A valid email address is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const db = getDb();

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (user) {
      await logAudit({
        user: { id: user.id, name: user.name },
        action: 'PASSWORD_RESET_REQUESTED',
        resourceType: 'User',
        resourceId: user.id,
        details: { email: normalizedEmail },
      });
    }

    // Always return success to prevent email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account matches this email, password recovery instructions have been sent.',
    });
  } catch (error: any) {
    console.error('[FORGOT PASSWORD ERROR]', error);
    return NextResponse.json(
      { success: false, message: 'Unable to process recovery request at this time.' },
      { status: 500 }
    );
  }
}
