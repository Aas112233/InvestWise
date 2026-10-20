"use client";

import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  TransactionsListView,
  TransactionRecord,
  SoftDeleteModal,
} from "@/components/transactions";
import { openPrintTab } from "@/lib/documents";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { hasScreenPermission } from "@/lib/permissions";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Soft-delete is a ledger write: gate the button on screen permission, not
  // a constant. An explicit READ grant overrides the role baseline, so a
  // read-only user never sees it (the API enforces the same check).
  const canManage = hasScreenPermission(user, "TRANSACTIONS", "WRITE");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Keystrokes update searchInput; only the debounced value enters the query
  // key — every keystroke would otherwise fire a ~250ms-RT round trip.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [typeFilter, setTypeFilter] = useState("");

  const [transactionToDelete, setTransactionToDelete] = useState<TransactionRecord | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // TanStack Query v5: Hierarchical key ["transactions", { ... }] (AGENTS.md §7)
  const {
    data: responseData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<{
    data: TransactionRecord[];
    pagination: { total: number; totalPages: number };
    metrics: { totalInflow: number; totalOutflow: number; netFlow: number };
  }>({
    queryKey: ["transactions", { page, pageSize, search, type: typeFilter }],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = {
          page,
          limit: pageSize,
        };
        if (search) params.search = search;
        if (typeFilter) params.type = typeFilter;

        return await apiClient("/transactions", { params });
      } catch (err: any) {
        toast.error(err?.message || t("common.errors.failedToLoadTransactions", { defaultValue: "Failed to load transactions" }));
        return {
          data: [],
          pagination: { total: 0, totalPages: 1 },
          metrics: { totalInflow: 0, totalOutflow: 0, netFlow: 0 },
        };
      }
    },
  });

  // Soft delete mutation
  const softDeleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return await apiClient(`/transactions/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(t("transactions.deletedSuccess", { defaultValue: "Transaction successfully soft-deleted" }));
      setIsDeleteModalOpen(false);
      setTransactionToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error?.message || t("common.errors.failedToSoftDeleteTransaction", { defaultValue: "Failed to soft-delete transaction" }));
    },
  });

  // The voucher is a printable document, not an in-app panel: opening it in the
  // shared print tab means the sheet the officer sees is the sheet the printer
  // produces (A4, no app chrome, no scrim bleeding through the page).
  const handlePrintVoucher = (tx: TransactionRecord) => {
    openPrintTab("voucher", tx.id);
  };

  const handleOpenSoftDelete = (tx: TransactionRecord) => {
    setTransactionToDelete(tx);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmSoftDelete = async (id: string, reason: string) => {
    await softDeleteMutation.mutateAsync({ id, reason });
  };

  return (
    <AppShell>
      <TransactionsListView
        transactions={responseData?.data || []}
        isLoading={isLoading}
        isRefreshing={isFetching}
        onRefresh={() => refetch()}
        totalCount={responseData?.pagination?.total || 0}
        currentPage={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setPage(1);
        }}
        searchQuery={searchInput}
        onSearchChange={(q) => {
          setSearchInput(q);
        }}
        typeFilter={typeFilter}
        onTypeFilterChange={(val) => {
          setTypeFilter(val);
          setPage(1);
        }}
        metrics={responseData?.metrics}
        onPrintVoucher={handlePrintVoucher}
        onSoftDelete={handleOpenSoftDelete}
        canManage={canManage}
      />

      {/* Soft Delete Modal */}
      <SoftDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setTransactionToDelete(null);
        }}
        transaction={transactionToDelete}
        onConfirm={handleConfirmSoftDelete}
        isDeleting={softDeleteMutation.isPending}
      />
    </AppShell>
  );
}
