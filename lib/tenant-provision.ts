import crypto from 'node:crypto';
import { getDb } from '@/db/index';
import {
  funds,
  systemSettings,
  subscriptionChangeLog,
  subscriptionPlans,
  tenantSubscriptions,
  tenants,
  users,
} from '@/db/schema/index';
import { DEFAULT_TENANT_SLUG } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_ORG_FUNDS,
  normalizeExtraFunds,
  resolveFinancialDefaults,
  type FinancialDefaultsInput,
} from '@/lib/org-setup';
import { hashPassword, validatePasswordStrength } from '@/lib/utils/password';
import { normalizeEmail } from '@/lib/utils/types';
import { isPlatformOwnerEmail } from '@/lib/platform-owner';
import { AppError, ConflictError, ValidationError, extractDbError } from '@/lib/utils/errors';

/**
 * The single path that mints a tenant and its first Admin. Both the platform
 * onboarding endpoint (SuperAdmin creates a customer) and public self-serve
 * signup (a visitor creates their own organization) call this, so the two can
 * never drift on password policy, permission grants, financial defaults, seed
 * funds, trial length, or the subscription change log.
 */

/**
 * Every screen at WRITE for a tenant's first Admin. Deliberate duplicate of
 * the lists in app/api/auth/{login,register} — a canonical screen registry is
 * the upgrade path, not this module's job. Admin also bypasses stored grants
 * (lib/permissions.ts hasScreenPermission), so this is belt-and-braces.
 */
const ALL_SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT',
  'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT',
  'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

/** Slugs that must never be handed to a self-serve organization. */
const RESERVED_SLUGS = new Set([DEFAULT_TENANT_SLUG, 'admin', 'api', 'app', 'www', 'mail', 'investwise']);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const PLAN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const EMAIL_MAX_LENGTH = 254;

export interface ProvisionTenantInput {
  /** Organization name — becomes tenant.name and system_settings.companyName. */
  organizationName: string;
  adminName: string;
  email: string;
  /** Plain password: validated and hashed here so no caller can skip it. */
  password: string;
  /** Number of days the new subscription stays in `trial`. */
  trialDays: number;
  /** Explicit slug (platform onboarding). Omitted → derived from the name. */
  slug?: string;
  /** Plan slug to attach. Required to exist when `plan` is combined with... */
  plan?: string;
  /** ...this: platform onboarding rejects an unknown plan, self-serve signs up
   * onto an unassigned plan rather than failing a paying-future customer. */
  onUnknownPlan?: 'reject' | 'fallback';
  maxUsers?: number;
  /**
   * Financial configuration written to the tenant's system_settings row: base
   * currency, date format, share value and fiscal year. Every part falls back
   * to the platform default in lib/org-setup.ts when omitted, and every part is
   * validated before the transaction opens.
   */
  financial?: FinancialDefaultsInput;
  /**
   * Optional extra funds the new owner names during signup ("add to the
   * defaults"). Only name + type survive; account numbers and opening balances
   * are generated server-side. Untrusted input, validated in normalizeExtraFunds
   * before the transaction opens.
   */
  funds?: unknown;
  /** Who caused this — subscription_change_log actor, null for self-serve. */
  actor?: { userId?: string | null; email?: string | null } | null;
  /** Human-readable reason recorded on the subscription change log. */
  reason: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  slug: string;
  adminUserId: string;
  email: string;
}

/** URL-safe name → slug base. Non-latin names collapse to 'org'. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'org';
}

/** Trailing separators would survive a slice and make an invalid slug. */
function normalizeSlug(value: string): string {
  return value.replace(/-+$/g, '').slice(0, 63).replace(/-+$/g, '');
}

function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max} characters`);
  }
  return trimmed;
}

/** Integer within range, or the default — never NaN, never a DB cast error. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return fallback;
  return Math.min(max, Math.max(min, n));
}

function assertValidInput(input: ProvisionTenantInput): void {
  requireText(input.organizationName, 'Organization name', 2, 120);
  requireText(input.adminName, 'Name', 2, 120);
  if (input.slug !== undefined) {
    requireText(input.slug, 'Slug', 3, 63);
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new ValidationError('Slug must be lowercase letters, digits or hyphens');
    }
    if (RESERVED_SLUGS.has(input.slug)) {
      throw new ValidationError('This slug is reserved');
    }
  }
  if (input.plan !== undefined && !PLAN_PATTERN.test(input.plan)) {
    throw new ValidationError('Unknown subscription plan');
  }
  if (!Number.isFinite(input.trialDays) || input.trialDays < 1 || input.trialDays > 365) {
    throw new ValidationError('Trial length must be between 1 and 365 days');
  }
  const strength = validatePasswordStrength(input.password);
  if (!strength.valid) {
    throw new ValidationError(strength.message ?? 'Password does not meet strength requirements');
  }
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  assertValidInput(input);

  const organizationName = input.organizationName.trim();
  const adminName = input.adminName.trim();

  if (typeof input.email !== 'string') throw new ValidationError('A valid email address is required');
  const email = normalizeEmail(input.email).slice(0, EMAIL_MAX_LENGTH);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('A valid email address is required');
  }

  // The SUPERADMIN_EMAILS allowlist authorizes on the address alone, so the
  // address itself is the credential: whoever holds the users row with it gets
  // every requireSuperAdmin gate regardless of the role stored beside it.
  // Provisioning must therefore never hand it out — same reasoning as the
  // reserved slugs below, and checked before any database touch.
  //
  // ConflictError rather than ForbiddenError because this is the public signup
  // path: a 409 reuses the deliberately ambiguous wording the route already
  // maps for duplicate emails, so the check does not become a new oracle for
  // which addresses are platform-owned. The platform onboarding route passes
  // the message through unchanged, so an operator still learns the reason.
  if (isPlatformOwnerEmail(email)) {
    throw new ConflictError('That email address is reserved for platform use');
  }

  // The reservation applies to derived slugs too: naming an organization
  // "Admin" or "InvestWise" would otherwise hand out a slug that presents as
  // platform-owned, and 'default' is how the auth layer resolves platform-scope
  // maintenance state. Checked before any database touch.
  const wantedSlug = normalizeSlug(input.slug ?? slugify(organizationName));
  if (RESERVED_SLUGS.has(wantedSlug)) {
    throw new ValidationError('That organization name is reserved. Use a different name.');
  }

  const db = getDb();
  const [slugTaken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, wantedSlug)).limit(1);
  const [emailTaken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (emailTaken) throw new ConflictError('A user with this email already exists');

  // Explicit slugs must be free (caller typed it); derived slugs get a suffix
  // so two orgs with the same name both sign up instead of one failing.
  let slug = wantedSlug;
  if (input.slug === undefined && slugTaken) {
    slug = normalizeSlug(`${wantedSlug}-${crypto.randomUUID().slice(0, 6)}`);
  } else if (slugTaken) {
    throw new ConflictError('A tenant with this slug already exists');
  }

  const [planRow] = input.plan
    ? await db
        .select({ id: subscriptionPlans.id })
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.slug, input.plan))
        .limit(1)
    : [];
  if (input.plan && !planRow && (input.onUnknownPlan ?? 'reject') === 'reject') {
    throw new ConflictError(`Unknown subscription plan: ${input.plan}`);
  }

  const passwordHash = await hashPassword(input.password);
  const perms: Record<string, string> = Object.fromEntries(ALL_SCREENS.map((s) => [s, 'WRITE']));
  const maxUsers = clampInt(input.maxUsers, 1, 100_000, 100);
  // Resolved before the transaction opens: an invalid currency, date format,
  // month or amount must fail without having written a single row.
  const financial = resolveFinancialDefaults(input.financial);
  const extraFunds = normalizeExtraFunds(input.funds);
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name: organizationName,
          plan: input.plan ?? 'standard',
          maxUsers,
          status: 'active',
          isMaintenanceMode: false,
        })
        .returning({ id: tenants.id });
      if (!tenant) throw new AppError('Failed to create tenant', 500);

      const [admin] = await tx
        .insert(users)
        .values({
          tenantId: tenant.id,
          name: adminName,
          email,
          password: passwordHash,
          // Hard floor on privilege: self-serve can only ever mint an Admin of
          // its own tenant. SuperAdmin is provisioned by seed/allowlist only.
          role: 'Admin',
          status: 'active',
          permissions: perms,
        })
        .returning({ id: users.id });
      if (!admin) throw new AppError('Failed to create tenant admin', 500);

      await tx.insert(systemSettings).values({
        tenantId: tenant.id,
        companyName: organizationName,
        baseCurrency: financial.baseCurrency,
        dateFormat: financial.dateFormat,
        fiscalYearStart: financial.fiscalYearStart,
        fiscalYearEnd: financial.fiscalYearEnd,
        // Column name is legacy (share_value_bdt) but holds the base-currency
        // unit value. Stays unlocked: a fresh tenant has no transactions, so the
        // share-value lock in the settings service is not triggered.
        shareValueBdt: financial.shareValue,
      });

      // Standard institutional funds, so a new organization can record a
      // deposit on day one instead of being handed an empty fund list, plus any
      // extra funds the owner named at signup ("add to the defaults").
      //
      // Account numbers carry the tenant slug because the live table enforces
      // UNIQUE (account_number) globally — not the per-tenant uniqueness
      // db/schema/funds.ts declares. Reusing a fixed number such as
      // 'IW-CENTRAL-001' would collide with the first tenant's row and abort
      // this whole transaction for every signup after it. Custom funds offset
      // their suffix past the standard set so per-tenant numbers stay unique
      // too. Opening balance is always '0.00': a public form must never seed
      // money (§12).
      const fundRows = [
        ...DEFAULT_ORG_FUNDS.map((f) => ({
          tenantId: tenant.id,
          name: f.name,
          type: f.type,
          status: 'ACTIVE',
          currency: financial.baseCurrency,
          accountNumber: `${slug.toUpperCase()}-${f.accountSuffix}`,
          // Decimal string at the boundary; a new fund holds no money (§12).
          balance: '0.00',
          reconciliationStatus: 'VERIFIED',
          handlingOfficer: adminName,
          description: f.description,
          isSystemAsset: f.isSystemAsset,
        })),
        ...extraFunds.map((f, i) => ({
          tenantId: tenant.id,
          name: f.name,
          type: f.type,
          status: 'ACTIVE',
          currency: financial.baseCurrency,
          accountNumber: `${slug.toUpperCase()}-CUSTOM-${String(DEFAULT_ORG_FUNDS.length + i + 1).padStart(3, '0')}`,
          balance: '0.00',
          reconciliationStatus: 'VERIFIED',
          handlingOfficer: adminName,
          description: null as string | null,
          isSystemAsset: false,
        })),
      ];
      await tx.insert(funds).values(fundRows);

      await tx.insert(tenantSubscriptions).values({
        tenantId: tenant.id,
        planId: planRow?.id ?? null,
        status: 'trial',
        trialEndsAt: new Date(now.getTime() + input.trialDays * 24 * 3600_000),
      });

      await tx.insert(subscriptionChangeLog).values({
        tenantId: tenant.id,
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? email,
        action: 'TENANT_ONBOARDED',
        toPlanId: planRow?.id ?? null,
        toStatus: 'trial',
        reason: input.reason,
      });

      return { tenantId: tenant.id, slug, adminUserId: admin.id, email };
    });
  } catch (error) {
    // Unique violations surface as a plain 409 the UI can show; anything else
    // is a real failure and must not be dressed up as one. Drizzle parks the
    // SQLSTATE on the nested cause, so read it through extractDbError rather
    // than error.code (which is undefined on the "Failed query" wrapper).
    const { code } = extractDbError(error);
    if (code === '23505') throw new ConflictError('That organization or email is already registered');
    throw error;
  }
}
