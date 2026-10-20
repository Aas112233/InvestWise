"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";
import type { PaginatedResponse } from "@/lib/utils/types";
import { useFundOptions, type MemberOption } from "@/components/deposits/shared";

/**
 * Rule §7 feeds for the Payouts screen. Query keys are hierarchical under
 * ["payouts"] so a mutation invalidates the whole area with one prefix.
 */

export interface PayoutInstallment {
  id: string;
  sequence: number;
  dueDate: string;
  amount: string;
  status: "SCHEDULED" | "PAID" | "CANCELLED";
  paidAt: string | null;
  transactionId: string | null;
}

export interface PayoutPlan {
  id: string;
  memberId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: string;
  sourceFundId: string;
  reason: string;
  createdAt: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  memberName?: string | null;
  memberCode?: string | null;
  memberStatus?: string | null;
  memberFreeBalance?: string | null;
  fundName?: string | null;
  scheduledCount?: number;
  awaitingProjectSettlement?: boolean;
  nextDue?: (PayoutInstallment & { isDue: boolean }) | null;
  installments?: PayoutInstallment[];
}

export interface PayoutsPage {
  data: PayoutPlan[];
  total: number;
}

/** A suspended member plus the free balance a payout would reserve. */
export interface SuspendedMemberOption extends MemberOption {
  totalContributed?: string | number | null;
}

export function useSuspendedMemberOptions() {
  return useQuery({
    queryKey: ["members", "dropdown", "suspended"],
    queryFn: async (): Promise<SuspendedMemberOption[]> => {
      const res = await apiClient<PaginatedResponse<SuspendedMemberOption>>("/members", {
        params: { page: 1, limit: 500, status: "suspended" },
      });
      // Only members who actually hold money can be settled; offering a 0.00
      // row would produce a guaranteed rejection at submit.
      return (res.data ?? []).filter((m) => Number(m.totalContributed ?? 0) > 0);
    },
    staleTime: 30_000,
  });
}

/** Payout funds are deposit containers only — the same rule the API enforces. */
export function usePayoutFundOptions() {
  return useFundOptions(DEPOSIT_FUND_TYPE);
}

export function usePayoutList(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string | null;
  sortBy: string;
  sortOrder: "asc" | "desc";
}) {
  return useQuery({
    queryKey: ["payouts", "list", params],
    queryFn: async (): Promise<PayoutsPage> => {
      const res = await apiClient<{ data: PayoutPlan[]; pagination: { total: number } }>("/payouts", {
        params: {
          page: params.page,
          limit: params.pageSize,
          search: params.search || undefined,
          status: params.status || undefined,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        },
      });
      return { data: res.data ?? [], total: res.pagination?.total ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export function usePayoutDetail(planId: string | null) {
  return useQuery({
    queryKey: ["payouts", "detail", planId],
    enabled: !!planId,
    queryFn: async (): Promise<PayoutPlan> => {
      const res = await apiClient<{ data: PayoutPlan }>(`/payouts/${planId}`);
      return res.data;
    },
  });
}

/** Every payout mutation touches the member balance, the fund and the ledger. */
function useInvalidatePayoutArea() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["payouts"] });
    qc.invalidateQueries({ queryKey: ["members"] });
    qc.invalidateQueries({ queryKey: ["funds"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["auditLogs"] });
  };
}

export function useCreatePayoutPlan() {
  const invalidate = useInvalidatePayoutArea();
  return useMutation({
    mutationFn: (payload: {
      memberId: string;
      sourceFundId: string;
      installmentCount: number;
      intervalMonths: number;
      firstDueDate: string;
      reason: string;
    }) => apiClient<{ data: { plan: PayoutPlan } }>("/payouts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: invalidate,
  });
}

export function usePayPayoutInstallment(planId: string) {
  const invalidate = useInvalidatePayoutArea();
  return useMutation({
    mutationFn: () => apiClient<{ data: PayoutPlan }>(`/payouts/${planId}/pay`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useTopUpPayoutPlan(planId: string) {
  const invalidate = useInvalidatePayoutArea();
  return useMutation({
    mutationFn: () => apiClient<{ data: PayoutPlan }>(`/payouts/${planId}/top-up`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useCancelPayoutPlan(planId: string) {
  const invalidate = useInvalidatePayoutArea();
  return useMutation({
    mutationFn: (reason: string) =>
      apiClient<{ data: PayoutPlan }>(`/payouts/${planId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: invalidate,
  });
}
