import { getDb } from '@/db/index';
import { auditLogs } from '@/db/schema/index';

interface AuditParams {
  user?: { id?: string; name?: string } | null;
  req?: { ip?: string; headers?: Record<string, string | undefined> } | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: unknown;
  status?: string;
  /** §6: tenant scope of the audited action — required for tenant business actions. */
  tenantId?: string | null;
  /**
   * Before/after row snapshots for update/delete flows (and after-only for
   * creates). Stored inside the existing `details` jsonb — no migration.
   *
   * Zero-extra-query contract: callers pass the row they ALREADY fetched
   * (tenant-scoped lookups are mandatory per §6, so `before` is free) and the
   * UPDATE's `.returning()` row (Postgres returns it in the same statement).
   * NEVER pass credential material (password hashes, tokens) — snapshots of
   * auth flows are action-only.
   */
  before?: unknown;
  after?: unknown;
}

/**
 * JSON-safe snapshot of a row (or partial row): Dates → ISO strings,
 * `undefined` dropped, non-objects passed through. BigInt → string so a
 * jsonb insert can never 500 on a numeric column variant.
 */
export function snapshotRow(row: unknown): unknown {
  if (row === null || row === undefined) return null;
  if (typeof row !== 'object') return row;
  if (row instanceof Date) return row.toISOString();
  if (Array.isArray(row)) return row.map(snapshotRow);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (value === undefined) continue;
    out[key] = value instanceof Date
      ? value.toISOString()
      : typeof value === 'bigint'
        ? value.toString()
        : value;
  }
  return out;
}

function withSnapshots(
  details: unknown,
  before: unknown,
  after: unknown,
): unknown {
  const base =
    typeof details === 'string'
      ? { message: details }
      : details && typeof details === 'object'
        ? { ...(details as Record<string, unknown>) }
        : null;
  if (before === undefined && after === undefined) {
    return base ?? details ?? null;
  }
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  if (before !== undefined) merged.before = snapshotRow(before);
  if (after !== undefined) merged.after = snapshotRow(after);
  return merged;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const db = getDb();
    const ip = params.req?.ip || params.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
    const userAgent = params.req?.headers?.['user-agent'] || null;

    await db.insert(auditLogs).values({
      userId: params.user?.id || null,
      userName: params.user?.name || null,
      tenantId: params.tenantId || null,
      action: params.action,
      resourceType: params.resourceType || 'System',
      resourceId: params.resourceId || null,
      details: withSnapshots(params.details, params.before, params.after) as any,
      ipAddress: ip,
      userAgent,
      status: params.status || 'SUCCESS',
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
