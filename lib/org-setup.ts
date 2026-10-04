import { ValidationError } from '@/lib/utils/errors';

/**
 * The organization defaults a new tenant is created with, and the enumerations
 * that bound them. Shared by the public signup form, the SuperAdmin settings
 * panel and lib/tenant-provision.ts so a value one of them offers is always a
 * value the writer accepts.
 */

export interface Option {
  value: string;
  label: string;
}

export const CURRENCIES: readonly Option[] = [
  { value: 'BDT', label: 'BDT — Bangladeshi Taka' },
  { value: 'PKR', label: 'PKR — Pakistani Rupee' },
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'GBP', label: 'GBP — Pound Sterling' },
];

// Mirrors the three formats lib/formatters.ts understands and the tenant
// Settings > System dropdown offers. Anything else would render dates raw.
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

// system_settings.fiscal_year_start/end store the full English month name
// (schema default 'July'/'June'), and Settings labels them via common.months.*.
export const FISCAL_MONTHS: ReadonlyArray<{ short: string; full: string }> = [
  { short: 'jan', full: 'January' },
  { short: 'feb', full: 'February' },
  { short: 'mar', full: 'March' },
  { short: 'apr', full: 'April' },
  { short: 'may', full: 'May' },
  { short: 'jun', full: 'June' },
  { short: 'jul', full: 'July' },
  { short: 'aug', full: 'August' },
  { short: 'sep', full: 'September' },
  { short: 'oct', full: 'October' },
  { short: 'nov', full: 'November' },
  { short: 'dec', full: 'December' },
];

/** Fund types the funds screen can edit (components/funds/fund-modal.tsx). */
export type DefaultFundType = 'DEPOSIT' | 'PRIMARY' | 'OTHER';

export interface DefaultFundSpec {
  name: string;
  type: DefaultFundType;
  /** Suffix appended to the tenant slug to form the account number. */
  accountSuffix: string;
  description: string;
  isSystemAsset: boolean;
}

/**
 * The standard institutional fund set, taken from the names already seeded for
 * the existing tenant (server/src/db/init-db.ts) so every new organization has
 * the same shape rather than a second vocabulary of near-miss names.
 *
 * Two deliberate changes from that seed, both to keep the funds screen usable:
 * the venture fund is PRIMARY rather than PROJECT (the server rejects manually
 * created PROJECT funds — those are auto-created with a project), and the
 * reserve is PRIMARY rather than the case-corrupted legacy 'Reserve' value,
 * which the live funds_type_check now normalizes to RESERVE. The create/edit
 * form offers DEPOSIT/PRIMARY/RESERVE/EMERGENCY/OTHER; signup restricts new
 * owners to the subset they can name meaningfully before any project exists.
 *
 * Names and descriptions are stored in English on purpose: they are tenant data
 * the owner can rename, not UI copy, and seeding them from the visitor's browser
 * locale would freeze a transient choice into the ledger.
 */
export const DEFAULT_ORG_FUNDS: readonly DefaultFundSpec[] = [
  {
    name: 'General Operating & Deposit Fund',
    type: 'DEPOSIT',
    accountSuffix: 'CENTRAL-001',
    description: 'Primary liquidity clearinghouse for shareholder deposits and member capital contributions',
    isSystemAsset: true,
  },
  {
    name: 'Project Venture & Development Fund',
    type: 'PRIMARY',
    accountSuffix: 'VENTURE-002',
    description: 'Capital deployment fund for strategic enterprise investments, assets, and project acquisitions',
    isSystemAsset: true,
  },
  {
    name: 'Emergency & Liquidity Reserve',
    type: 'PRIMARY',
    accountSuffix: 'EMERGENCY-003',
    description: 'Contingency pool and liquidity safety net',
    isSystemAsset: true,
  },
  {
    name: 'Dividend & Profit Distribution Pool',
    type: 'OTHER',
    accountSuffix: 'DIVIDEND-004',
    description: 'Vault for distributing project return dividends and capital gains',
    isSystemAsset: false,
  },
];

/**
 * Fund types a self-serve signup may name. PROJECT is excluded because the
 * platform auto-creates it with a project (components/funds/fund-modal.tsx);
 * a new owner chooses only among the three they can edit later.
 */
export const SIGNUP_FUND_TYPES: readonly DefaultFundType[] = ['DEPOSIT', 'PRIMARY', 'OTHER'];

/** Ceiling on extra funds one signup may request, to bound the public payload. */
export const MAX_EXTRA_FUNDS = 10;

const FUND_NAME_MIN = 2;
const FUND_NAME_MAX = 120;

export interface ExtraFundInput {
  name: string;
  type: DefaultFundType;
}

/**
 * Validate the optional list of extra funds a new owner may name during signup
 * ("add to the defaults"). Only a bounded {name, type} list is accepted —
 * opening balances, account numbers and every other column stay server-set
 * (§12: a public, unauthenticated form must not inject money). Called from
 * inside provisioning before the transaction opens, so an invalid row fails
 * without writing anything. Undefined / empty returns no extras, keeping the
 * standard-seed path byte-for-byte the behavior before this feature.
 */
export function normalizeExtraFunds(input: unknown): ExtraFundInput[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new ValidationError("[Field 'funds', Code: invalid_type] Funds must be a list");
  }
  if (input.length > MAX_EXTRA_FUNDS) {
    throw new ValidationError(`[Field 'funds', Code: too_many] At most ${MAX_EXTRA_FUNDS} custom funds can be added`);
  }
  return input.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new ValidationError(`[Field 'funds[${i}]', Code: invalid_type] Fund must be an object`);
    }
    const { name, type } = raw as { name?: unknown; type?: unknown };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < FUND_NAME_MIN || trimmed.length > FUND_NAME_MAX) {
      throw new ValidationError(
        `[Field 'funds[${i}].name', Code: invalid_name] Fund name must be ${FUND_NAME_MIN}-${FUND_NAME_MAX} characters`,
      );
    }
    if (typeof type !== 'string' || !(SIGNUP_FUND_TYPES as readonly string[]).includes(type)) {
      throw new ValidationError(`[Field 'funds[${i}].type', Code: invalid_type] Unsupported fund type`);
    }
    return { name: trimmed, type: type as DefaultFundType };
  });
}

export const DEFAULT_CURRENCY = 'BDT';
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';
export const DEFAULT_FISCAL_YEAR_START = 'July';
export const DEFAULT_FISCAL_YEAR_END = 'June';
export const DEFAULT_SHARE_VALUE = '1000.00';

/** Money crosses the Postgres boundary as a 2dp string, never a float (§8/§12). */
const SHARE_VALUE_RE = /^\d{1,10}(\.\d{1,2})?$/;

export interface FinancialDefaults {
  baseCurrency: string;
  dateFormat: string;
  shareValue: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
}

export interface FinancialDefaultsInput {
  baseCurrency?: unknown;
  dateFormat?: unknown;
  shareValue?: unknown;
  fiscalYearStart?: unknown;
  fiscalYearEnd?: unknown;
}

/**
 * Absent or empty falls back to the platform default; a wrong type is rejected
 * rather than quietly replaced, so a client sending `shareValue: 1000` as a
 * number cannot slip past the money-format check below.
 */
function textOr(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new ValidationError(`[Field '${field}', Code: invalid_type] Expected text`);
  }
  return value.trim();
}

/**
 * Validates and normalizes the financial configuration of a new tenant,
 * substituting the platform defaults for anything omitted.
 *
 * Called from inside the provisioning transaction, so an out-of-vocabulary
 * currency, date format, month or malformed amount is rejected before any row
 * is written rather than landing as a settings screen that cannot display its
 * own stored value.
 */
export function resolveFinancialDefaults(input: FinancialDefaultsInput = {}): FinancialDefaults {
  const currencyCodes = new Set(CURRENCIES.map((c) => c.value));
  const months = new Set(FISCAL_MONTHS.map((m) => m.full));

  const baseCurrency = textOr(input.baseCurrency, DEFAULT_CURRENCY, 'baseCurrency');
  if (!currencyCodes.has(baseCurrency)) {
    throw new ValidationError(`[Field 'baseCurrency', Code: invalid_currency] Not a supported currency`);
  }

  const dateFormat = textOr(input.dateFormat, DEFAULT_DATE_FORMAT, 'dateFormat');
  if (!(DATE_FORMATS as readonly string[]).includes(dateFormat)) {
    throw new ValidationError(`[Field 'dateFormat', Code: invalid_date_format] Not a supported date format`);
  }

  const fiscalYearStart = textOr(input.fiscalYearStart, DEFAULT_FISCAL_YEAR_START, 'fiscalYearStart');
  if (!months.has(fiscalYearStart)) {
    throw new ValidationError(`[Field 'fiscalYearStart', Code: invalid_month] Not a month name`);
  }
  const fiscalYearEnd = textOr(input.fiscalYearEnd, DEFAULT_FISCAL_YEAR_END, 'fiscalYearEnd');
  if (!months.has(fiscalYearEnd)) {
    throw new ValidationError(`[Field 'fiscalYearEnd', Code: invalid_month] Not a month name`);
  }
  if (fiscalYearStart === fiscalYearEnd) {
    throw new ValidationError(`[Field 'fiscalYearEnd', Code: invalid_month] Fiscal year start and end must differ`);
  }

  const shareValue = textOr(input.shareValue, DEFAULT_SHARE_VALUE, 'shareValue');
  if (!SHARE_VALUE_RE.test(shareValue) || Number(shareValue) <= 0) {
    throw new ValidationError(
      `[Field 'shareValue', Code: invalid_amount] Share value must be above 0 with at most 2 decimals`,
    );
  }

  return {
    baseCurrency,
    dateFormat,
    // toFixed on a regex-validated decimal string: the value never becomes a
    // float the way money must not, and the column is decimal(15,2).
    shareValue: Number(shareValue).toFixed(2),
    fiscalYearStart,
    fiscalYearEnd,
  };
}
