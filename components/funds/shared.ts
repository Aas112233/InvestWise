"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { PaginatedResponse } from "@/lib/utils/types";

export interface FundRow {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
  currency?: string | null;
  balance: number | string;
  minimumBalance?: number | string | null;
  handlingOfficer?: string | null;
  description?: string | null;
  accountNumber?: string | null;
  linkedProjectId?: string | null;
  lastReconciledAt?: string | null;
  reconciliationStatus?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function useFundsList(params: { type: string | null; status: string | null }) {
  return useQuery({
    queryKey: ["funds", params],
    queryFn: async (): Promise<{ data: FundRow[]; total: number }> => {
      const res = await apiClient<PaginatedResponse<FundRow>>("/funds", {
        params: {
          type: params.type || undefined,
          status: params.status || undefined,
          limit: 100,
        },
      });
      return { data: res.data ?? [], total: res.meta?.total ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export function fundTypeLabelKey(type: string | null | undefined): string {
  switch ((type || "").toUpperCase()) {
    case "DEPOSIT":
      return "funds.types.deposit";
    case "PRIMARY":
      return "funds.types.primary";
    case "PROJECT":
      return "funds.types.project";
    default:
      return "funds.types.other";
  }
}
