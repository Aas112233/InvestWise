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
import { usePermissions } from "@/lib/use-permissions";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  Building2,
  Briefcase,
  Layers,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { ExpenseModal } from "./expense-modal";

export interface ExpenseRecord {
  id: string;
  referenceNumber: string;
  date: string;
  type: string;
  expenseName?: string;
  category?: string;
  amount: string | number;
  status: string;
  description: string;
  fundId?: string;
  fundName?: string;
  projectId?: string;
  projectName?: string;
  memberId?: string;
  memberName?: string;
  handlingOfficer?: string;
  approvedByName?: string;
}

export function ExpensesView() {
  const { t } = useLocale();
  const { can } = usePermissions();
  // Write-gated via the shared evaluator; the POST /api/expenses API
  // enforces the same screen server-side, so this only hides dead buttons.
  const canWrite = can("EXPENSES", "WRITE");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [fundFilter, setFundFilter] = useState("");
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

  // TanStack Query v5: Hierarchical key ["expenses", { ... }]
  const { data: responseData, isLoading, refetch, isFetching } = useQuery<{
    data: ExpenseRecord[];
    pagination: { total: number; totalPages: number };
    metrics?: { totalExpenses: number; operationalTotal: number; projectTotal: number };
  }>({
    queryKey: ["expenses", { page, pageSize, search, category: categoryFilter, fundId: fundFilter }],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = {
          page,
          limit: pageSize,
        };
        if (search) params.search = search;
        if (categoryFilter) params.category = categoryFilter;
        if (fundFilter) params.fundId = fundFilter;

        return await apiClient("/expenses", { params });
      } catch (err: any) {
        toast.error(err?.message || t("common.errors.failedToLoadExpenses", { defaultValue: "Failed to load expenses" }));
        return {
          data: [],
          pagination: { total: 0, totalPages: 1 },
        };
      }
    },
  });

  const { data: fundsData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["funds", "options"],
    queryFn: async () => {
      try {
        return await apiClient("/funds?limit=100");
      } catch {
        return { data: [] };
      }
    },
  });

  const fundOptions: DropdownOption[] = (fundsData?.data || []).map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const categoryOptions: DropdownOption[] = [
    { value: "Operational", label: t("expenses.categories.operational") },
    { value: "Marketing", label: t("expenses.categories.marketing") },
    { value: "Legal", label: t("expenses.categories.legal") },
    { value: "Travel", label: t("expenses.categories.travel") },
    { value: "Technology", label: t("expenses.categories.technology") },
    { value: "Maintenance", label: t("expenses.categories.maintenance") },
    { value: "Other", label: "Other" },
  ];

  const records = responseData?.data || [];
  const totalCount = responseData?.pagination?.total || 0;

  const totalExpenseSum = records.reduce(
    (acc, curr) => acc + (parseFloat(String(curr.amount)) || 0),
    0
  );

  const columns: ERPColumn<ExpenseRecord>[] = [
    {
      key: "date",
      header: t("expenses.expenseDate"),
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
      key: "expenseName",
      header: t("expenses.expenseName", { defaultValue: "Expense Name" }),
      render: (row) => (
        <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
          {row.expenseName || "-"}
        </span>
      ),
    },
    {
      key: "category",
      header: t("expenses.category"),
      render: (row) => {
        const cat = row.category || "General";
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
            {cat}
          </span>
        );
      },
    },
    {
      key: "memberName",
      header: t("expenses.expenseBy", { defaultValue: "Expense By" }),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.memberName || "-"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-xs text-rose-600 dark:text-rose-400">
          -{formatMoney(row.amount, "BDT")}
        </span>
      ),
    },
    {
      key: "fundName",
      header: t("expenses.deductFromFund"),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.fundName || "-"}
        </span>
      ),
    },
    {
      key: "projectName",
      header: t("expenses.projectOptional"),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.projectName || "-"}
        </span>
      ),
    },
    {
      key: "approvedByName",
      header: t("expenses.approvedBy", { defaultValue: "Approved By" }),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.approvedByName || "-"}
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
            {t("expenses.reportTitle")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("expenses.recordOutflow")}
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
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsExpenseModalOpen(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              {t("expenses.strategicAllocation")}
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("expenses.cumulativeOutflow")}
          value={formatMoney(totalExpenseSum, "BDT")}
          icon={<ArrowDownLeft className="w-4 h-4" />}
          tone="rose"
          description="Outflow in current view"
        />
        <ERPMetricCard
          label={t("expenses.categories.operational")}
          value="Primary Liquid"
          icon={<Building2 className="w-4 h-4" />}
          tone="slate"
          description="Treasury fund deductions"
        />
        <ERPMetricCard
          label="Direct Disbursements"
          value="Project-linked"
          icon={<Briefcase className="w-4 h-4" />}
          tone="slate"
          description="Capital expenditure allocations"
        />
        <ERPMetricCard
          label={t("expenses.expenseCount")}
          value={String(totalCount)}
          icon={<Layers className="w-4 h-4" />}
          tone="slate"
          description="Total verified expense vouchers"
        />
      </div>

      {/* Filter Toolbar */}
      <div className="p-3 bg-card border border-border/80 rounded-xl flex flex-col md:flex-row items-center gap-3">
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder={t("expenses.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="w-full md:w-56">
          <AppDropdown
            options={categoryOptions}
            value={categoryFilter}
            onChange={(val) => {
              setCategoryFilter(val || "");
              setPage(1);
            }}
            placeholder={t("expenses.filterCategoryPlaceholder", { defaultValue: "Filter category..." })}
          />
        </div>

        <div className="w-full md:w-56">
          <AppDropdown
            options={fundOptions}
            value={fundFilter}
            onChange={(val) => {
              setFundFilter(val || "");
              setPage(1);
            }}
            placeholder={t("expenses.filterFundPlaceholder", { defaultValue: "Filter fund..." })}
          />
        </div>

        {(search || categoryFilter || fundFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setCategoryFilter("");
              setFundFilter("");
              setPage(1);
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Expenses ERP Table */}
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
          emptyActionLabel={canWrite ? t("expenses.strategicAllocation") : undefined}
          onEmptyAction={canWrite ? () => setIsExpenseModalOpen(true) : undefined}
        />
      </div>

      {/* Expense Modal */}
      <ExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        currency="BDT"
      />
    </div>
  );
}
