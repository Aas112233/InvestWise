import { eq } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { systemSettings } from '@/db/schema/index';

/**
 * DB-backed companion of lib/tenant-time.ts (kept separate so the pure
 * helpers stay importable from client code). One indexed PK-ish read per
 * request that needs the tenant's zone — same pattern as the paymentMethods
 * settings reads already present on these routes.
 *
 * Fail-safe: a missing settings row or junk value falls back to the platform
 * default (Asia/Dhaka), which is the behaviour every existing tenant had
 * before this column existed.
 */
export async function getTenantTimezone(tenantId: string | null | undefined): Promise<string> {
  if (!tenantId) return 'Asia/Dhaka';
  try {
    const db = getDb();
    const [row] = await db
      .select({ timezone: systemSettings.timezone })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, tenantId))
      .limit(1);
    return row?.timezone || 'Asia/Dhaka';
  } catch {
    return 'Asia/Dhaka';
  }
}
