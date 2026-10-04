/**
 * Tenant module entitlements.
 *
 * A tenant is licensed for a set of modules; the platform operator toggles
 * them per tenant from /admin/feature-flags and the tenant inspector. This is
 * the single source of truth for BOTH sidebar visibility and API gating — a
 * module hidden in the UI but still writable over the API is not an entitlement.
 *
 * `core` modules cannot be switched off: without members or funds the product
 * has nothing to operate on, and a tenant left with no core module is a tenant
 * an operator cannot support.
 */

export const TENANT_MODULE_KEYS = [
  // core — always on
  'members',
  'funds',
  'settings',
  // finance
  'deposits',
  'transactions',
  'expenses',
  'dividends',
  'analysis',
  'reports',
  // operations
  'projects',
  'meetings',
  'governance',
  'goals',
  'requestDeposit',
  'audit',
] as const;

export type TenantModuleKey = (typeof TENANT_MODULE_KEYS)[number];

export type ModuleCategory = 'core' | 'finance' | 'operations';

export interface TenantModuleDefinition {
  key: TenantModuleKey;
  /** i18n path for the label. */
  labelKey: string;
  category: ModuleCategory;
  /** When true the toggle is rendered locked-on and the API rejects false. */
  required: boolean;
  defaultEnabled: boolean;
}

export const TENANT_MODULE_DEFINITIONS: readonly TenantModuleDefinition[] = [
  { key: 'members', labelKey: 'tenantModules.members', category: 'core', required: true, defaultEnabled: true },
  { key: 'funds', labelKey: 'tenantModules.funds', category: 'core', required: true, defaultEnabled: true },
  { key: 'settings', labelKey: 'tenantModules.settings', category: 'core', required: true, defaultEnabled: true },

  { key: 'deposits', labelKey: 'tenantModules.deposits', category: 'finance', required: false, defaultEnabled: true },
  { key: 'transactions', labelKey: 'tenantModules.transactions', category: 'finance', required: false, defaultEnabled: true },
  { key: 'expenses', labelKey: 'tenantModules.expenses', category: 'finance', required: false, defaultEnabled: true },
  { key: 'dividends', labelKey: 'tenantModules.dividends', category: 'finance', required: false, defaultEnabled: true },
  { key: 'analysis', labelKey: 'tenantModules.analysis', category: 'finance', required: false, defaultEnabled: false },
  { key: 'reports', labelKey: 'tenantModules.reports', category: 'finance', required: false, defaultEnabled: true },

  { key: 'projects', labelKey: 'tenantModules.projects', category: 'operations', required: false, defaultEnabled: true },
  { key: 'meetings', labelKey: 'tenantModules.meetings', category: 'operations', required: false, defaultEnabled: true },
  { key: 'governance', labelKey: 'tenantModules.governance', category: 'operations', required: false, defaultEnabled: true },
  { key: 'goals', labelKey: 'tenantModules.goals', category: 'operations', required: false, defaultEnabled: true },
  { key: 'requestDeposit', labelKey: 'tenantModules.requestDeposit', category: 'operations', required: false, defaultEnabled: true },
  { key: 'audit', labelKey: 'tenantModules.audit', category: 'operations', required: false, defaultEnabled: true },
] as const;

const MODULE_SET = new Set<string>(TENANT_MODULE_KEYS);
const REQUIRED_KEYS = TENANT_MODULE_DEFINITIONS.filter((m) => m.required).map((m) => m.key);

/** Route prefix -> module key, for request-time gating. */
export const MODULE_ROUTE_PREFIXES: ReadonlyArray<readonly [string, TenantModuleKey]> = [
  ['/api/deposits', 'deposits'],
  ['/api/request-deposit', 'requestDeposit'],
  ['/api/transactions', 'transactions'],
  ['/api/expenses', 'expenses'],
  ['/api/dividends', 'dividends'],
  ['/api/analysis', 'analysis'],
  ['/api/reports', 'reports'],
  ['/api/projects', 'projects'],
  ['/api/meetings', 'meetings'],
  ['/api/governance', 'governance'],
  ['/api/goals', 'goals'],
  ['/api/audit', 'audit'],
  ['/api/members', 'members'],
  ['/api/funds', 'funds'],
  ['/api/settings', 'settings'],
];

export function isTenantModuleKey(value: unknown): value is TenantModuleKey {
  return typeof value === 'string' && MODULE_SET.has(value);
}

export function moduleForApiPath(pathname: string): TenantModuleKey | null {
  for (const [prefix, key] of MODULE_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

/** Default entitlement map — every module at its declared default. */
export function defaultModuleAccess(): Record<string, boolean> {
  return Object.fromEntries(
    TENANT_MODULE_DEFINITIONS.map((m) => [m.key, m.defaultEnabled])
  );
}

/**
 * Merge a stored (possibly partial, possibly hand-edited) jsonb value over the
 * defaults, dropping unknown keys and forcing required modules on. A malformed
 * or empty value therefore degrades to "everything at its default" instead of
 * locking a paying tenant out of their own data.
 */
export function resolveModuleAccess(stored: unknown): Record<string, boolean> {
  const base = defaultModuleAccess();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  const src = stored as Record<string, unknown>;
  const out: Record<string, boolean> = { ...base };
  for (const key of TENANT_MODULE_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  for (const key of REQUIRED_KEYS) out[key] = true;
  return out;
}

export type ModuleAccessPatchValidation =
  | { ok: true; value: Record<string, boolean> }
  | { ok: false; message: string; code: string };

/**
 * Validate a partial entitlement patch. AGENTS.md §11 field-error shape.
 * Rejects unknown keys and attempts to disable a required module rather than
 * silently ignoring them, so a typo in the panel cannot look like a save.
 */
export function validateModuleAccessPatch(body: unknown): ModuleAccessPatchValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: "[Field 'moduleAccess', Code: invalid_type] Expected an object of module -> boolean",
    };
  }
  const src = body as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!isTenantModuleKey(key)) {
      return {
        ok: false,
        code: 'UNKNOWN_MODULE',
        message: `[Field 'moduleAccess.${key}', Code: unknown_module] Not a licensable module`,
      };
    }
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: `[Field 'moduleAccess.${key}', Code: invalid_type] Expected boolean`,
      };
    }
    if (value === false && REQUIRED_KEYS.includes(key)) {
      return {
        ok: false,
        code: 'REQUIRED_MODULE',
        message: `[Field 'moduleAccess.${key}', Code: required_module] This module is required and cannot be disabled`,
      };
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: "[Field 'moduleAccess', Code: too_small] At least one module must be provided",
    };
  }
  return { ok: true, value: out };
}
