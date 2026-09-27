"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ERPDataTable,
  ERPColumn,
  ERPMetricCard,
  AppDropdown,
  DropdownOption,
  Button,
  StatusBadge,
} from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import {
  PieChart,
  TrendingUp,
  ShieldCheck,
  Users,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { DividendDistributionModal } from "./dividend-distribution-modal";

export interface DividendRecord {
  id: string;
  referenceNumber: string;
  date: string;
  type: string;
  amount: string | number;
  status: string;
  description: string;
  memberId?: string;
  memberName?: string;
  memberCode?: string;
  fundId?: string;
  fundName?: string;
}

export function DividendsView() {
  const { t } = useLocale();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [isDistributeModalOpen, setIsDistributeModalOpen] = useState(false);

  // TanStack Query v5: Hierarchical key ["dividends", { ... }]
  const { data: responseData, isLoading, refetch, isFetching } = useQuery<{
    data: DividendRecord[];
    pagination: { total: number; totalPages: number };
  }>({
    queryKey: ["dividends", { page, pageSize, search, memberId: memberFilter }],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = {
          page,
          limit: pageSize,
          type: "Dividend",
        };
        if (search) params.search = search;
        if (memberFilter) params.memberId = memberFilter;

        return await apiClient("/transactions", { params });
      } catch (err: any) {
        toast.error(err?.message || t("common.errors.failedToLoadDividendHistory", { defaultValue: "Failed to load dividend history" }));
        return {
          data: [],
          pagination: { total: 0, totalPages: 1 },
        };
      }
    },
  });

  const { data: membersData } = useQuery<{ data: Array<{ id: string; name: string; memberId: string }> }>({
    queryKey: ["members", "dropdown"],
    queryFn: async () => {
      try {
        return await apiClient("/members?limit=200");
      } catch {
        return { data: [] };
      }
    },
  });

  const memberOptions: DropdownOption[] = (membersData?.data || []).map((m) => ({
    value: m.id,
    label: `${m.name} (${m.memberId})`,
  }));

  const records = responseData?.data || [];
  const totalCount = responseData?.pagination?.total || 0;

  // Calculate total distributed amount from loaded records
  const totalDistributedAmount = records.reduce(
    (acc, curr) => acc + (parseFloat(String(curr.amount)) || 0),
    0
  );

  const columns: ERPColumn<DividendRecord>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
          {formatDate(row.date)}
        </span>
      ),
    },
    {
      key: "referenceNumber",
      header: t("expenses.expRef"),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
          {row.referenceNumber || "-"}
        </span>
      ),
    },
    {
      key: "member",
      header: t("dividends.recipient"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-center">
            {(row.memberName || "M").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span className="font-medium text-slate-900 dark:text-slate-100 block text-xs">
              {row.memberName || "All Members"}
            </span>
            {row.memberCode && (
              <span className="text-[10px] font-mono text-slate-400">
                {row.memberCode}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: t("dividends.payout"),
      align: "right",
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-xs text-emerald-600 dark:text-emerald-400">
          {formatMoney(row.amount, "BDT")}
        </span>
      ),
    },
    {
      key: "fundName",
      header: "Fund",
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.fundName || "-"}
        </span>
      ),
    },
    {
      key: "description",
      header: t("expenses.reasonEntity"),
      render: (row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs block">
          {row.description || "-"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const tone = row.status === "Completed" ? "emerald" : "cyan";
        return <StatusBadge tone={tone}>{row.status}</StatusBadge>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("dividends.payoutConfig")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("dividends.configSub")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common.update")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsDistributeModalOpen(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {t("dividends.payoutTab")}
          </Button>
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("dividends.totalRevenue")}
          value={formatMoney(totalDistributedAmount, "BDT")}
          icon={<PieChart className="w-4 h-4" />}
          tone="emerald"
          description="Distributed in current view"
        />
        <ERPMetricCard
          label={t("dividends.execLogic")}
          value="Share-Weighted"
          icon={<TrendingUp className="w-4 h-4" />}
          tone="slate"
          description="Proportional equity allocation"
        />
        <ERPMetricCard
          label="Statutory Buffer"
          value="10.00%"
          icon={<ShieldCheck className="w-4 h-4" />}
          tone="amber"
          description="Retained statutory reserve"
        />
        <ERPMetricCard
          label={t("dividends.stakeholderMatrix")}
          value={String(totalCount)}
          icon={<Users className="w-4 h-4" />}
          tone="slate"
          description="Total dividend payouts recorded"
        />
      </div>

      {/* Filters Bar */}
      <div className="p-3 bg-card border border-border/80 rounded-xl flex flex-col md:flex-row items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder={t("common.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="w-full md:w-64">
          <AppDropdown
            options={memberOptions}
            value={memberFilter}
            onChange={(val) => {
              setMemberFilter(val || "");
              setPage(1);
            }}
            placeholder={t("dividends.selectDeparting")}
          />
        </div>

        {(search || memberFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setMemberFilter("");
              setPage(1);
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Dividend Ledger Data Table */}
      <div className="bg-card border border-border/80 rounded-xl overflow-hidden">
        <ERPDataTable
          columns={columns}
          data={records}
          isLoading={isLoading}
          totalCount={totalCount}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          emptyActionLabel={t("dividends.payoutTab")}
          onEmptyAction={() => setIsDistributeModalOpen(true)}
        />
      </div>

      {/* Distribution Modal */}
      <DividendDistributionModal
        isOpen={isDistributeModalOpen}
        onClose={() => setIsDistributeModalOpen(false)}
        currency="BDT"
      />
    </div>
  );
}
