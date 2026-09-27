"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  TransactionsListView,
  TransactionRecord,
  SoftDeleteModal,
  VoucherDrawer,
  TransactionVoucherData,
} from "@/components/transactions";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function TransactionsPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [selectedVoucher, setSelectedVoucher] = useState<TransactionVoucherData | null>(null);
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);

  const [transactionToDelete, setTransactionToDelete] = useState<TransactionRecord | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // TanStack Query v5: Hierarchical key ["transactions", { ... }] (AGENTS.md §7)
  const { data: responseData, isLoading } = useQuery<{
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

  const handleViewVoucher = (tx: TransactionRecord) => {
    setSelectedVoucher({
      id: tx.id,
      referenceNumber: tx.referenceNumber,
      date: tx.date,
      type: tx.type,
      amount: tx.amount,
      category: tx.category,
      description: tx.description,
      memberName: tx.memberName,
      memberCode: tx.memberCode,
      fundName: tx.fundName,
      projectName: tx.projectName,
      depositMethod: tx.depositMethod,
      handlingOfficer: tx.handlingOfficer,
      status: tx.status,
    });
    setIsVoucherOpen(true);
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
        totalCount={responseData?.pagination?.total || 0}
        currentPage={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setPage(1);
        }}
        searchQuery={search}
        onSearchChange={(q) => {
          setSearch(q);
          setPage(1);
        }}
        typeFilter={typeFilter}
        onTypeFilterChange={(val) => {
          setTypeFilter(val);
          setPage(1);
        }}
        metrics={responseData?.metrics}
        onViewVoucher={handleViewVoucher}
        onSoftDelete={handleOpenSoftDelete}
        canManage={true}
      />

      {/* Voucher Drawer */}
      <VoucherDrawer
        isOpen={isVoucherOpen}
        onClose={() => setIsVoucherOpen(false)}
        voucher={selectedVoucher}
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
