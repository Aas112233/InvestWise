/**
 * Tenant-scoped category vocabularies — the single source for the two
 * selection lists that used to be hardcoded in the client (expense categories
 * and project sectors).
 *
 * Before this existed each list was a literal array duplicated across two
 * components with no server-side counterpart, so:
 *   - an org could not add/rename/remove a category without a code change;
 *   - the API accepted ANY string (both columns are plain varchar), so the
 *     hardcoded client array was decorative, not authoritative;
 *   - the two copies could drift apart silently.
 *
 * Categories are now per-tenant jsonb data on system_settings (same proven
 * shape as payment_methods) and the server validates every write against them.
 *
 * Deletion semantics: removing a category makes it unselectable but NOT
 * invalid. Historical rows keep their stored string and stay readable — a
 * 2024 expense labelled "Travel" must still render after Travel is removed
 * from the list, otherwise editing the list would retroactively blank out the
 * ledger and every report. `isAllowedCategory` therefore accepts the live
 * list OR any value already present in history.
 */

/** Ceilings mirrored by the DB columns (transactions.category is varchar(100)). */
export const EXPENSE_CATEGORY_MAX = 100;
export const PROJECT_CATEGORY_MAX = 255;
/** A single category label is a list chip, not prose. */
const CATEGORY_LABEL_MAX = 60;
/** Bound on list length so the jsonb stays small and the dropdown stays usable. */
export const CATEGORY_LIST_MAX = 100;

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  'Operations',
  'Project Expense',
  'Governance Fine',
  'Marketing',
  'Legal',
  'Travel',
  'Technology',
  'Maintenance',
  'Other',
];

export const DEFAULT_PROJECT_CATEGORIES: string[] = [
  'Real Estate',
  'Agriculture',
  'Technology',
  'Retail',
  'Manufacturing',
  'Other',
];

/**
 * Values that must stay selectable even when a tenant removes them, because
 * internal write paths stamp them rather than a user choosing them.
 *
 * 'Investment' is written by the project ledger path (app/api/projects/route.ts
 * and app/api/projects/[id]/route.ts) for share-capital rows, so it can appear
 * in transactions history without ever being in a dropdown.
 */
const INTERNAL_CATEGORIES = new Set<string>(['Investment']);

/**
 * System-stamped values the user must not be allowed to redefine. These are
 * ledger bookkeeping labels, not business vocabulary — letting a tenant delete
 * or rename 'Investment' would break the project share-capital write path.
 */
export function isReservedCategory(label: string): boolean {
  return INTERNAL_CATEGORIES.has(label);
}

/**
 * Coerce an untrusted jsonb/body value into a clean, deduped category list.
 * Returns the default vocabulary when the input is absent, malformed, or
 * normalises to nothing — a tenant can never end up with an empty picker.
 */
export function normalizeCategories(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    // Collapse internal whitespace so "Real  Estate" cannot masquerade as a
    // second distinct category beside "Real Estate".
    const label = item.trim().replace(/\s+/g, ' ').slice(0, CATEGORY_LABEL_MAX);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= CATEGORY_LIST_MAX) break;
  }
  return out.length > 0 ? out : fallback;
}

/**
 * Server-side gate for a category written to transactions.category or
 * projects.category.
 *
 * `history` is the set of category strings already stored for this tenant. It
 * is passed in (rather than queried here) so the caller decides how to fetch
 * it, and so this stays a pure function that is cheap to test.
 *
 * `history` is what makes the "categories become tenant data" change safe for
 * existing installs: a project created before this feature carries sectors such
 * as 'Energy & Infrastructure' that no default list contains. Without history a
 * tenant's very first edit to such a project — which resends the unchanged
 * category — would be rejected.
 */
export function isAllowedCategory(
  stored: string | null | undefined,
  configured: string[],
  history: Iterable<string> = [],
): boolean {
  if (stored === null || stored === undefined || stored === '') return false;
  if (configured.includes(stored)) return true;
  if (INTERNAL_CATEGORIES.has(stored)) return true;
  for (const past of history) {
    if (past === stored) return true;
  }
  return false;
}

/** Human-readable rejection message naming the configured list. */
export function categoryRejectionMessage(field: string, configured: string[]): string {
  // Display the first few so the user knows what IS valid without a wall of text.
  const preview = configured.slice(0, 5).join(', ');
  const suffix = configured.length > 5 ? ', …' : '';
  return `${field} must be one of the configured categories (${preview}${suffix})`;
}
