"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * The tenant's fiscal years and their posting status — the single feed behind
 * every year/month picker AND the header's global fiscal-year selector.
 *
 * Lives in its own module (not in lib/fiscal-period-options) so the global
 * selection context can read it without importing the option builders, which
 * in turn depend on that context. One query, one cache entry.
 *
 * `/api/fiscal/years` is readable by every member of the tenant (unlike
 * `/api/fiscal/periods`, which gates on FISCAL READ for its ledger totals), and
 * shares the `["fiscalPeriods"]` prefix so starting, closing or reopening a
 * year on the Fiscal screen updates every picker at once.
 */

export interface FiscalPeriodYear {
  year: number;
  status: string | null;
}

export function useFiscalPeriodYears(options?: { enabled?: boolean }): {
  years: FiscalPeriodYear[];
  openFiscalYear: string | null;
  pending: boolean;
  failed: boolean;
} {
  const { data, isPending, isError } = useQuery({
    queryKey: ["fiscalPeriods", "years"],
    queryFn: async (): Promise<FiscalPeriodYear[]> => {
      const res = await apiClient<{ data: FiscalPeriodYear[] }>("/fiscal/years");
      return res.data ?? [];
    },
    staleTime: 60_000,
    // The header's fiscal-year provider lives above the routes (lib/providers),
    // so it must stay silent on public pages — an unauthenticated call here
    // would 401 and drag the api client's session-expiry logic into /login.
    enabled: options?.enabled ?? true,
  });

  const years = data ?? [];
  // "OPEN" only — the exact predicate fiscal-guard posts under. The deposit
  // banner's looser OPEN||ACTIVE test would offer years the write rejects.
  const open = years.find((period) => period.status === "OPEN");

  return {
    years,
    openFiscalYear: open ? String(open.year) : null,
    pending: isPending,
    failed: isError,
  };
}
