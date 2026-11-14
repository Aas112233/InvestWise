import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { systemSettings, transactions, projects } from '@/db/schema/index';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PROJECT_CATEGORIES,
  normalizeCategories,
} from '@/lib/categories';

/**
 * DB-backed companion of lib/categories.ts (split the same way as
 * lib/tenant-time.ts + lib/tenant-time-db.ts) so the pure validation helpers
 * stay importable from client components without dragging in drizzle.
 *
 * The history read is what makes category deletion safe: it lets
 * `isAllowedCategory` accept a value that a tenant has since removed from the
 * list but which historical rows still carry, so editing the vocabulary never
 * retroactively invalidates the ledger.
 */

export type CategoryKind = 'expense' | 'project';

export interface CategoryContext {
  /** Live, tenant-configured list (never empty — falls back to platform defaults). */
  configured: string[];
  /** Distinct values already stored on this tenant's rows. */
  history: Set<string>;
}

async function loadConfigured(tenantId: string, kind: CategoryKind): Promise<string[]> {
  const db = getDb();
  const [row] = await db
    .select({
      expense: systemSettings.expenseCategories,
      project: systemSettings.projectCategories,
    })
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  if (kind === 'expense') {
    return normalizeCategories(row?.expense, DEFAULT_EXPENSE_CATEGORIES);
  }
  return normalizeCategories(row?.project, DEFAULT_PROJECT_CATEGORIES);
}

async function loadHistory(tenantId: string, kind: CategoryKind): Promise<Set<string>> {
  const db = getDb();
  const column = kind === 'expense' ? transactions.category : projects.category;
  const rows = await db
    .selectDistinct({ value: column })
    .from(kind === 'expense' ? transactions : projects)
    .where(
      kind === 'expense'
        ? eq(transactions.tenantId, tenantId)
        : eq(projects.tenantId, tenantId),
    )
    // Cap the scan: history is only consulted for equality checks, and a
    // tenant with absurdly many distinct historical labels must not turn every
    // write into a full-table read. Ordered for determinism.
    .orderBy(sql`1`)
    .limit(500);

  const out = new Set<string>();
  for (const row of rows) {
    const value = (row as { value: string | null }).value;
    if (typeof value === 'string' && value) out.add(value);
  }
  return out;
}

/**
 * Load the configured list plus stored history for one category kind.
 * Two indexed reads; called only on the write paths that need the gate.
 */
export async function getCategoryContext(
  tenantId: string,
  kind: CategoryKind,
): Promise<CategoryContext> {
  const [configured, history] = await Promise.all([
    loadConfigured(tenantId, kind),
    loadHistory(tenantId, kind),
  ]);
  return { configured, history };
}
