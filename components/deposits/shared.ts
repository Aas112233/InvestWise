"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/utils/types";
import type { StatusTone } from "@/components/ui/status-badge";

export interface DepositRow {
  id: string;
  type: string;
  amount: number | string;
  description?: string | null;
  category?: string | null;
  referenceNumber?: string | null;
  date: string;
  submittedDate?: string | null;
  status?: string | null;
  memberId?: string | null;
  fundId?: string | null;
  handlingOfficer?: string | null;
  depositMethod?: string | null;
  /** Deposit month (YYYY-MM) — the month the deposit is FOR, may differ from date. */
  depositMonth?: string | null;
  authorizedBy?: string | null;
  balanceBefore?: number | string | null;
  balanceAfter?: number | string | null;
  createdAt?: string;
  memberName?: string | null;
  memberIdStr?: string | null;
  fundName?: string | null;
}

// §8: deposit month pickers are dropdowns over dynamic arrays, never free
// text. Shared by the deposit form and the request-deposit form so both
// always agree on values and ranges.
export const DEPOSIT_MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

export function buildDepositMonthOptions(t: (k: string) => string) {
  return DEPOSIT_MONTH_KEYS.map((key, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: t(`common.months.${key}`),
  }));
}

/** Back-entry window: next year down to ten years back, newest first. */
export function buildDepositYearOptions() {
  return Array.from({ length: 12 }, (_, i) => {
    const y = new Date().getFullYear() + 1 - i;
    return { value: String(y), label: String(y) };
  });
}

export interface MemberOption {
  id: string;
  memberId: string;
  name: string;
  email?: string | null;
  status: string;
  // Deposit form: amount autofill = shares × tenant share value.
  shares?: number;
}

export interface FundOption {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
  balance: number | string;
  minimumBalance?: number | string | null;
  currency?: string | null;
}

export interface DepositsPage {
  data: DepositRow[];
  total: number;
  /** Filtered SUM of amounts — server-computed, avoids a full-row fetch. */
  sum?: string;
}

// GET /api/deposits returns { success, data, pagination, sum } (not the shared
// PaginatedResponse envelope) — normalized here for ERPDataTable.
export function useDepositsList(params: {
  page: number;
  pageSize: number;
  search: string;
  memberId: string | null;
  fundId: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Deposit month (YYYY-MM) — filters on the month a deposit is FOR. */
  monthKey?: string | null;
}) {
  return useQuery({
    queryKey: ["deposits", params],
    queryFn: async (): Promise<DepositsPage> => {
      const res = await apiClient<{
        success: boolean;
        data: DepositRow[];
        sum?: string;
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>("/deposits", {
        params: {
          page: params.page,
          limit: params.pageSize,
          search: params.search || undefined,
          memberId: params.memberId || undefined,
          fundId: params.fundId || undefined,
          status: params.status || undefined,
          startDate: params.monthKey ? undefined : params.startDate || undefined,
          endDate: params.monthKey ? undefined : params.endDate || undefined,
          depositMonth: params.monthKey || undefined,
        },
      });
      return { data: res.data ?? [], total: res.pagination?.total ?? 0, sum: res.sum };
    },
    placeholderData: (prev) => prev,
  });
}

/**
 * Monthly collection total for the deposits header.
 *
 * Previously this fetched pageSize:1000 full deposit rows (with member/fund
 * joins) and summed them in the browser — a heavy round trip for one number.
 * Now it asks the server for a SUM aggregate: one row back.
 */
export function useDepositsMonthlyTotal(
  startDate: string | null,
  endDate: string | null,
  memberId: string | null = null,
) {
  return useQuery({
    queryKey: ["deposits", "aggregate", { startDate, endDate, memberId }],
    queryFn: async (): Promise<string> => {
      const res = await apiClient<{ success: boolean; data: { total: string; count: number } }>("/deposits", {
        params: {
          aggregateOnly: "true",
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          memberId: memberId || undefined,
        },
      });
      return res.data?.total ?? "0";
    },
    staleTime: 60_000,
  });
}

// Rule §7 dropdown feeds.
export function useMemberOptions() {
  return useQuery({
    queryKey: ["members", "dropdown"],
    queryFn: async (): Promise<MemberOption[]> => {
      const res = await apiClient<PaginatedResponse<MemberOption>>("/members", {
        params: { page: 1, limit: 500 },
      });
      return res.data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useFundOptions() {
  return useQuery({
    queryKey: ["funds", "dropdown"],
    queryFn: async (): Promise<FundOption[]> => {
      const res = await apiClient<PaginatedResponse<FundOption>>("/funds", {
        params: { page: 1, limit: 200 },
      });
      return res.data ?? [];
    },
    staleTime: 60_000,
  });
}

// Tenant settings hooks now live in lib/use-tenant-settings.ts (single shared
// query + fetcher). Re-exported here so existing screen imports keep working.
export { useTenantCurrency, useTenantDateFormat, useTenantSettings } from "@/lib/use-tenant-settings";

export function depositStatusTone(status: string | null | undefined): StatusTone {
  const s = (status || "").toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS" || s === "VERIFIED") return "emerald";
  if (s === "PENDING" || s === "PROCESSING") return "amber";
  if (s === "REJECTED" || s === "FAILED") return "rose";
  return "slate";
}

/** Integer-cents sum — never float arithmetic on money (Rule §12). */
export function sumCents(amounts: (number | string | null | undefined)[]): number {
  let total = 0;
  for (const a of amounts) {
    const n = typeof a === "string" ? parseFloat(a) : (a ?? 0);
    if (typeof n === "number" && Number.isFinite(n)) total += Math.round(n * 100);
  }
  return total;
}

export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** YYYY-MM key for a transaction date (deposit month grouping). */
export function monthKeyOf(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Month boundaries (ISO) for a YYYY-MM key. */
export function monthRange(key: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(y, mo, 0).getDate();
  const mm = String(mo).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

/** Last N calendar years (descending) for dynamic fiscal arrays. */
export function recentYears(count: number = 5): string[] {
  const y = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => String(y - i));
}
