"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useFiscalPeriodYears } from "@/lib/fiscal-period-options";
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

// §8: deposit period pickers are dropdowns over the tenant's fiscal arrays —
// see useFiscalPeriodOptions() in lib/fiscal-period-options, used by every
// deposit screen so they always agree on values and ranges. DEPOSIT_MONTH_KEYS
// stays for rendering an absolute YYYY-MM month label.
export const DEPOSIT_MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

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
  /**
   * Management desk only: hide PENDING deposit REQUESTS (they live on the
   * Request Deposit screen's inbox). The request screen omits this and sees
   * everything. Completed requests are real money and stay on both screens.
   */
  excludePendingRequests?: boolean;
  /** Server-side header sort — the desk paginates, so a browser sort only
   *  reorders the rows already on screen. */
  sortBy: string;
  sortOrder: 'asc' | 'desc';
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
          // The `sum` this response carries feeds the "Collected this month"
          // header — a money figure — so it must exclude unsettled rows even
          // when the table itself is showing every status (report issue 27).
          settledOnly: "true",
          startDate: params.monthKey ? undefined : params.startDate || undefined,
          endDate: params.monthKey ? undefined : params.endDate || undefined,
          depositMonth: params.monthKey || undefined,
          excludePendingRequests: params.excludePendingRequests ? "true" : undefined,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        },
      });
      return { data: res.data ?? [], total: res.pagination?.total ?? 0, sum: res.sum };
    },
    placeholderData: (prev) => prev,
  });
}

/** One month of a member's fiscal-year deposit grid. */
export interface MemberDepositMonthCell {
  /** Absolute calendar month, YYYY-MM. */
  month: string;
  /** A settled deposit or a pending request already holds the month. */
  occupied: boolean;
  status: string | null;
  category: string | null;
  /** Money already recorded for the month (decimal(15,2) string). */
  amount: string | null;
  transactionId: string | null;
  referenceNumber: string | null;
  /** Held by a pending request — it must be approved/rejected, not reverted. */
  pendingRequest: boolean;
  /**
   * H6 — settled deposits recorded FOR this month, and their sum. Non-null only for a flexible
   * schedule, where a month may hold several deposits and `occupied` is false for all of them;
   * null means the server did not measure it (monthly), which is NOT the same as zero.
   */
  depositCount: number | null;
  periodTotal: string | null;
}

export interface MemberDepositMonths {
  member: {
    id: string;
    name: string;
    memberId: string;
    status: string | null;
    shares: number;
    totalContributed: string | null;
    lastDepositMonth: string | null;
  };
  fiscalYear: string;
  fiscalYearStart: string;
  /**
   * Which deposit model produced the grid. Absent on a server predating the flexible model, in
   * which case monthly is the correct reading (the stricter one).
   */
  depositSchedule?: "monthly" | "flexible";
  obligationEnforced?: boolean;
  months: MemberDepositMonthCell[];
}

/**
 * The month grid behind the single-member bulk collection AND the deposit
 * form's month picker: which months of one fiscal year already hold a deposit
 * for the member.
 *
 * The server expands the fiscal year from the tenant's own calendar and applies
 * the SAME occupancy rule the bulk POST enforces, so a month this feed reports
 * as taken is exactly a month the write would refuse. Keyed under the
 * `["deposits"]` prefix: any deposit mutation invalidates it automatically, and
 * the grid re-greys the month that was just recorded.
 *
 * Not fetched until a member and a year are chosen — the endpoint answers one
 * member per call and must never be driven speculatively.
 *
 * `keepPreviousData` serves the bulk grid, which changes both member and year
 * as the desk works. The deposit form opts out: it must never label one
 * member's grid as another member's while the new one loads.
 */
export function useMemberDepositMonths(
  memberId: string | null,
  fiscalYear: string | null,
  options: { keepPreviousData?: boolean } = {},
) {
  return useQuery({
    queryKey: ["deposits", "month-status", { memberId, fiscalYear }],
    enabled: Boolean(memberId && fiscalYear),
    placeholderData: options.keepPreviousData
      ? (prev: MemberDepositMonths | undefined) => prev
      : undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<MemberDepositMonths> => {
      const res = await apiClient<MemberDepositMonths & { success: boolean }>("/finance/deposits/month-status", {
        params: { memberId, fiscalYear },
      });
      return res;
    },
  });
}

/**
 * Monthly collection total for the deposits header.
 *
 * Previously this fetched pageSize:1000 full deposit rows (with member/fund
 * joins) and summed them in the browser — a heavy round trip for one number.
 * Now it asks the server for a SUM aggregate: one row back.
 */export function useDepositsMonthlyTotal(
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
          // "Collected" is settled money only — a PENDING request or a REJECTED
          // slip is not cash in hand (report issue 27).
          settledOnly: "true",
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

/**
 * Fund picker feed. Pass a fund type (e.g. `DEPOSIT_FUND_TYPE` from
 * `lib/deposit-fund.ts`) to offer only that container — the deposit and
 * request-deposit forms do, because member money may only land in a DEPOSIT
 * fund. The deposits list filter stays unfiltered so legacy rows in another
 * container remain findable.
 */
export function useFundOptions(fundType?: string) {
  return useQuery({
    queryKey: ["funds", "dropdown", fundType ?? "all"],
    queryFn: async (): Promise<FundOption[]> => {
      const res = await apiClient<PaginatedResponse<FundOption>>("/funds", {
        params: { page: 1, limit: 200, ...(fundType ? { type: fundType } : {}) },
      });
      return res.data ?? [];
    },
    staleTime: 60_000,
  });
}

/**
 * #65: whether ANY fiscal period is OPEN for posting. The deposit write path
 * fails closed without one (lib/fiscal-guard.ts), so the form warns BEFORE the
 * user fills everything in and hits a toast they may never connect to the
 * missing fiscal year.
 *
 * Reads the tenant-readable /api/fiscal/years list rather than
 * /api/fiscal/periods: the latter gates on FISCAL READ, so the clerks who
 * actually post deposits got a 403 and never saw this warning at all. Shares
 * the ["fiscalPeriods"] prefix, so starting a year on the Fiscal screen updates
 * the banner immediately. `data` stays undefined while unknown — loading or a
 * failed request must not fire a warning.
 */
export function useHasOpenFiscalPeriod(): { data: boolean | undefined } {
  const { openFiscalYear, pending, failed } = useFiscalPeriodYears();
  if (pending || failed) return { data: undefined };
  return { data: openFiscalYear !== null };
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
