import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { systemSettings, DEFAULT_PENALTY_RULES, PenaltyRuleConfig } from '@/db/schema/index';
import { getAuthContext } from '@/lib/middleware/auth';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();
    const [settings] = await db
      .select({ penaltyRules: systemSettings.penaltyRules })
      .from(systemSettings)
      .limit(1);

    const rules = (settings?.penaltyRules as PenaltyRuleConfig[] | undefined) || DEFAULT_PENALTY_RULES;

    return NextResponse.json({
      success: true,
      data: rules,
    });
  } catch (err: any) {
    console.error('[GOVERNANCE RULES GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch rules' },
      { status: 500 }
    );
  }
}
