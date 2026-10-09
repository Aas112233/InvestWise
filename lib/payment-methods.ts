/**
 * Tenant-scoped payment methods — the single vocabulary shared by the
 * settings screen, both deposit forms and the ledger write routes.
 *
 * Before this existed the two deposit forms hardcoded DIFFERENT method
 * vocabularies ("Cash/Bank/..." vs "BKASH/NAGAD/...") against a fixed DB
 * CHECK constraint that only matched one of them — every deposit-request
 * insert 500'd on the constraint. Methods are now per-tenant data (name the
 * org sets + a coarse type the org picks), so the rigid CHECK constraint was
 * dropped in migration 0008 and replaced by server-side validation here.
 */

export const PAYMENT_TYPES = ['CASH', 'BANK', 'MOBILE', 'CHECK', 'OTHER'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export interface PaymentMethodConfig {
  /** Free-text label the organisation sets, e.g. "bKash" or "DBBL Bank Transfer". */
  name: string;
  /** Coarse channel category the organisation selects. */
  type: PaymentType;
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { name: 'Cash', type: 'CASH' },
  { name: 'Bank Transfer', type: 'BANK' },
  { name: 'bKash', type: 'MOBILE' },
  { name: 'Nagad', type: 'MOBILE' },
  { name: 'Rocket', type: 'MOBILE' },
  { name: 'Check', type: 'CHECK' },
  { name: 'Other', type: 'OTHER' },
];

export const PAYMENT_TYPE_LABEL_KEY: Record<PaymentType, string> = {
  CASH: 'settings.paymentMethods.types.cash',
  BANK: 'settings.paymentMethods.types.bank',
  MOBILE: 'settings.paymentMethods.types.mobile',
  CHECK: 'settings.paymentMethods.types.check',
  OTHER: 'settings.paymentMethods.types.other',
};

/** Coerce an untrusted jsonb/query value into a valid, deduped method list. */
export function normalizePaymentMethods(value: unknown): PaymentMethodConfig[] {
  if (!Array.isArray(value)) return DEFAULT_PAYMENT_METHODS;
  const seen = new Set<string>();
  const out: PaymentMethodConfig[] = [];
  for (const item of value) {
    const raw = item as Partial<PaymentMethodConfig>;
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    const type = PAYMENT_TYPES.includes(raw?.type as PaymentType) ? (raw.type as PaymentType) : null;
    if (!name || !type) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, type });
  }
  return out.length > 0 ? out : DEFAULT_PAYMENT_METHODS;
}

/**
 * Values historical rows and internal server defaults carry that must always
 * be readable/acceptable even when a tenant later edits its configured list —
 * ledger history is never retroactively invalidated.
 */
const INTERNAL_AND_LEGACY_METHODS = new Set<string>([
  'Cash',
  'Bank',
  'Mobile Banking',
  'Check',
  'Other',
  'Bank Transfer',
  'Manual',
]);

/**
 * Server-side gate for writes to transactions.deposit_method: null/empty is
 * allowed (the column is optional), otherwise the value must exactly match a
 * configured method name, one of the legacy/internal values (history + the
 * 'Manual' default some write paths stamp), or be rejected. Case-sensitive on
 * purpose — the stored name is the display string in ledger and reports.
 */
export function isAllowedDepositMethod(
  stored: string | null | undefined,
  methods: PaymentMethodConfig[],
): boolean {
  if (stored === null || stored === undefined || stored === '') return true;
  if (INTERNAL_AND_LEGACY_METHODS.has(stored)) return true;
  return methods.some((m) => m.name === stored);
}
