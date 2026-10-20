"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiClient } from "./api-client";
import { useAuth } from "./auth-context";
import { formatMoney, formatDatePattern, formatDateOnly } from "./formatters";
import { DEFAULT_PAYMENT_METHODS, type PaymentMethodConfig } from "./payment-methods";

export interface PenaltyRuleSetting {
  tier: number;
  title: string;
  type: "VERBAL_WARNING" | "FUND_DEDUCTION" | "SUSPENSION" | string;
  deductionAmount?: number;
  isPercentage?: boolean;
}

export interface TenantSettings {
  organization?: {
    companyName?: string;
    companyTagline?: string;
    companyAddress?: string;
    companyEmail?: string;
    companyPhone?: string;
    companyWebsite?: string;
    companyRegNo?: string;
  };
  financial?: {
    fiscalYearStart?: string;
    fiscalYearEnd?: string;
    baseCurrency?: string;
    taxRate?: number;
    accountingMethod?: string;
    shareValueBdt?: number | string | null;
    isShareValueLocked?: boolean;
    withdrawalLimitPercent?: number;
    withdrawalNoticeDays?: number;
    maxWithdrawalPerRequest?: number;
    statutoryReservePercent?: number | string | null;
    lastFiscalCloseDate?: string | null;
  };
  governance?: {
    monthlyMeetingDay?: number;
    depositDueDate?: number;
    gracePeriodDays?: number;
    lateDepositGraceMonths?: number;
    inactiveAfterMonths?: number;
    suspendedAfterMonths?: number;
    meetingTypes?: string[];
    penaltyRules?: PenaltyRuleSetting[];
    paymentMethods?: PaymentMethodConfig[];
  };
  system?: {
    language?: string;
    refreshInterval?: string;
    theme?: string;
    dateFormat?: string;
    isMaintenanceMode?: boolean;
    locale?: string;
  };
}

const SETTINGS_STALE_MS = 5 * 60_000;

export const DEFAULT_TENANT_MEETING_TYPES = [
  "FOUNDING_MEMBER",
  "SHAREHOLDER",
  "INVESTOR",
];

export const DEFAULT_TENANT_PENALTY_RULES: PenaltyRuleSetting[] = [
  { tier: 1, title: "1st Offense - Verbal Warning", type: "VERBAL_WARNING", deductionAmount: 0, isPercentage: false },
  { tier: 2, title: "2nd Offense - Minor Fine", type: "FUND_DEDUCTION", deductionAmount: 50, isPercentage: false },
  { tier: 3, title: "3rd Offense - Major Fine", type: "FUND_DEDUCTION", deductionAmount: 200, isPercentage: false },
  { tier: 4, title: "4th Offense - Suspension & Severe Deduction", type: "SUSPENSION", deductionAmount: 500, isPercentage: false },
];

/**
 * Shared cache key for tenant settings (audit F-10, 2026-10-13).
 *
 * The payload is owned by the session tenant, so the key carries it: an
 * identity switch inside one browser tab (logout → login as another
 * organisation, without a reload) otherwise replayed the PREVIOUS tenant's
 * currency / share value / penalty rules from the module-level QueryClient
 * until the next refetch. Consumers that read OR write the cache (notably
 * app/settings/page.tsx) must build the key through this hook so optimistic
 * writes land on the same entry.
 */
export function useTenantSettingsQueryKey(): readonly unknown[] {
  const { user } = useAuth();
  return ["settings", user?.tenantId ?? null];
}

/**
 * Single source of truth for tenant settings on the client.
 *
 * `enabled` lets a provider that lives above the routes (the header's fiscal
 * year, lib/providers) stay silent on public pages: an unauthenticated
 * /api/settings call 401s and drags the api client's session-expiry handling
 * into /login.
 */
export function useTenantSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: useTenantSettingsQueryKey(),
    queryFn: () => apiClient<TenantSettings>("/settings"),
    staleTime: SETTINGS_STALE_MS,
    refetchOnMount: false,
    enabled: options?.enabled ?? true,
  });
}

/** Tenant display currency (falls back to BDT per legacy behavior). */
export function useTenantCurrency(): string {
  const { data } = useTenantSettings();
  return data?.financial?.baseCurrency || "BDT";
}

/** Tenant date display pattern (falls back to DD/MM/YYYY per legacy behavior). */
export function useTenantDateFormat(): string {
  const { data } = useTenantSettings();
  return data?.system?.dateFormat || "DD/MM/YYYY";
}

/** Tenant share value in BDT (falls back to 1000). */
export function useTenantShareValue(): number {
  const { data } = useTenantSettings();
  const val = Number(data?.financial?.shareValueBdt ?? 1000);
  return Number.isFinite(val) && val > 0 ? val : 1000;
}

/** Tenant meeting types list from governance settings. */
export function useTenantMeetingTypes(): string[] {
  const { data } = useTenantSettings();
  return data?.governance?.meetingTypes && data.governance.meetingTypes.length > 0
    ? data.governance.meetingTypes
    : DEFAULT_TENANT_MEETING_TYPES;
}

/** Tenant penalty rules from governance settings. */
export function useTenantPenaltyRules(): PenaltyRuleSetting[] {
  const { data } = useTenantSettings();
  return data?.governance?.penaltyRules && data.governance.penaltyRules.length > 0
    ? data.governance.penaltyRules
    : DEFAULT_TENANT_PENALTY_RULES;
}

/**
 * Tenant-configured payment methods (Settings → Governance). Deposit forms
 * build their method pickers from this; falls back to the platform defaults
 * so a tenant that never configured any still gets a working, sane list.
 */
export function useTenantPaymentMethods(): PaymentMethodConfig[] {
  const { data } = useTenantSettings();
  return data?.governance?.paymentMethods && data.governance.paymentMethods.length > 0
    ? data.governance.paymentMethods
    : DEFAULT_PAYMENT_METHODS;
}

/** Formats a numeric amount using the active tenant's base currency. */
export function useFormatMoney() {
  const currency = useTenantCurrency();
  return useCallback(
    (
      amount: number | string | null | undefined,
      overrideCurrency?: string,
      options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
    ) => {
      return formatMoney(amount, overrideCurrency || currency, options);
    },
    [currency],
  );
}

/** Formats a date using the active tenant's date pattern. */
export function useFormatDate() {
  const dateFormat = useTenantDateFormat();
  return useCallback(
    (date: string | Date | null | undefined, includeTime: boolean = false) => {
      return formatDatePattern(date, dateFormat, includeTime);
    },
    [dateFormat],
  );
}

/**
 * Formats a DATE-ONLY value (a calendar day: ledger posting dates, project
 * start/completion dates) in UTC using the tenant's date pattern. See
 * formatDateOnly — local formatting shifts the day for viewers west of UTC.
 */
export function useFormatDateOnly() {
  const dateFormat = useTenantDateFormat();
  return useCallback(
    (date: string | Date | null | undefined) => formatDateOnly(date, dateFormat),
    [dateFormat],
  );
}
