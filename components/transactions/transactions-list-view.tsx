"use client";

import React from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  Search,
  Printer,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { ERPDataTable, ERPColumn, ERPMetricCard, AppDropdown, Button, StatusBadge } from "@/components/ui";
import { useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { useLocale } from "@/lib/i18n";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { getTransactionTypeLabel, getTransactionStatusLabel, getTransactionStatusTone } from "./shared";
import { ledgerRef } from "@/lib/doc-number";

export interface TransactionRecord {
  id: string;
  referenceNumber: string;
  date: string;
  type: string;
  category?: string;
  amount: number | string;
  status: string;
  description: string;
  memberId?: string;
  memberName?: string;
  memberCode?: string;
  fundId?: string;
  fundName?: string;
  projectId?: string;
  projectName?: string;
  handlingOfficer?: string;
  depositMethod?: string;
  isDeleted?: boolean;
}

interface TransactionsListViewProps {
  transactions: TransactionRecord[];
  isLoading: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
  metrics?: {
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
  };
  onPrintVoucher: (tx: TransactionRecord) => void;
  onSoftDelete: (tx: TransactionRecord) => void;
  canManage: boolean;
}

export function TransactionsListView({
  transactions,
  isLoading,
  isRefreshing,
  onRefresh,
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  metrics,
  onPrintVoucher,
  onSoftDelete,
  canManage,
}: TransactionsListViewProps) {
  const { t } = useLocale();
  const formatDate = useFormatDateOnly();
  const formatMoney = useFormatMoney();

  const typeOptions = [
    { value: "", label: t("transactions.allTypes", { defaultValue: "All Types" }) },
    { value: "Deposit", label: t("transactions.typeDeposit", { defaultValue: "Deposit (Inflow)" }) },
    { value: "Expense", label: t("transactions.typeExpense", { defaultValue: "Expense (Outflow)" }) },
    { value: "Dividend", label: t("transactions.typeDividend", { defaultValue: "Dividend (Payout)" }) },
    { value: "Transfer", label: t("transactions.typeTransfer", { defaultValue: "Fund Transfer" }) },
    { value: "Earning", label: t("transactions.typeEarning", { defaultValue: "Project Earning" }) },
  ];

  const columns: ERPColumn<TransactionRecord>[] = [
    {
      key: "referenceNumber",
      header: t("transactions.refHeader", { defaultValue: "Ref Number" }),
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
          {ledgerRef(row)}
        </span>
      ),
    },
    {
      key: "date",
      header: t("transactions.dateHeader", { defaultValue: "Date" }),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {row.date ? formatDate(String(row.date)) : t("common.na", { defaultValue: "—" })}
        </span>
      ),
    },
    {
      key: "type",
      header: t("transactions.typeHeader", { defaultValue: "Type" }),
      render: (row) => {
        const typeStr = String(row.type);
        const norm = typeStr.toLowerCase();
        const isPositive = norm === "deposit" || norm === "earning";
        const typeLabel = getTransactionTypeLabel(typeStr, t);
        return (
          <div className="flex items-center gap-1.5">
            {isPositive ? (
              <ArrowDownLeft size={13} className="text-emerald-500 shrink-0" />
            ) : (
              <ArrowUpRight size={13} className="text-rose-500 shrink-0" />
            )}
            <StatusBadge tone={isPositive ? "emerald" : norm === "dividend" ? "amber" : "slate"}>
              {typeLabel}
            </StatusBadge>
          </div>
        );
      },
    },
    {
      key: "party",
      header: t("transactions.partyHeader", { defaultValue: "Entity / Fund" }),
      render: (row) => (
        <div className="text-xs">
          <span className="font-medium text-slate-900 dark:text-slate-100 block">
            {row.memberName || row.projectName || row.fundName || t("transactions.generalTreasury", { defaultValue: "General Treasury" })}
          </span>
          {row.memberCode && (
            <span className="text-[11px] text-slate-400 font-mono">
              {row.memberCode}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: t("transactions.amountHeader", { defaultValue: "Amount" }),
      align: "right",
      render: (row) => {
        const norm = String(row.type).toLowerCase();
        const isPositive = norm === "deposit" || norm === "earning";
        return (
          <span className={`font-mono text-xs font-bold ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {isPositive ? "+" : "-"}{formatMoney(Number(row.amount))}
          </span>
        );
      },
    },
    {
      key: "description",
      header: t("transactions.descriptionHeader", { defaultValue: "Narration" }),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate block">
          {translateLedgerDescription(String(row.description || ""), t) || t("common.na", { defaultValue: "—" })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("transactions.statusHeader", { defaultValue: "Status" }),
      render: (row) => {
        const statusLabel = getTransactionStatusLabel(row.status, t);
        const tone = getTransactionStatusTone(row.status);
        return (
          <StatusBadge tone={tone}>
            {statusLabel}
          </StatusBadge>
        );
      },
    },
    {
      key: "actions",
      header: t("transactions.actions", { defaultValue: "Actions" }),
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            icon={Printer}
            onClick={() => onPrintVoucher(row)}
            title={t("transactions.printVoucher", { defaultValue: "Print Voucher" })}
            aria-label={t("transactions.printVoucher", { defaultValue: "Print Voucher" })}
          />
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => onSoftDelete(row)}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              title={t("transactions.softDelete", { defaultValue: "Soft Delete" })}
              aria-label={t("transactions.softDelete", { defaultValue: "Soft Delete" })}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("transactions.title", { defaultValue: "Financial Transactions" })}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("transactions.subtitle", { defaultValue: "Audit-grade immutable financial journal and multi-entity transaction ledger" })}
          </p>
        </div>
        {onRefresh && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={RefreshCw}
              loading={isRefreshing}
              onClick={onRefresh}
            >
              {t("transactions.refresh", { defaultValue: "Refresh" })}
            </Button>
          </div>
        )}
      </div>

      {/* Executive Financial Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ERPMetricCard
          label={t("transactions.totalInflow", { defaultValue: "Total Deposit Inflow" })}
          value={formatMoney(metrics?.totalInflow ?? 0)}
          icon={ArrowDownLeft}
          tone="emerald"
          helperText={t("transactions.metrics.verifiedInflowHelper", { defaultValue: "Verified member deposits & project earnings" })}
        />
        <ERPMetricCard
          label={t("transactions.totalOutflow", { defaultValue: "Total Capital Outflow" })}
          value={formatMoney(metrics?.totalOutflow ?? 0)}
          icon={ArrowUpRight}
          tone="rose"
          helperText={t("transactions.metrics.approvedOutflowHelper", { defaultValue: "Approved expenses, dividends & spending" })}
        />
        <ERPMetricCard
          label={t("transactions.netBalance", { defaultValue: "Net Operating Flow" })}
          value={formatMoney(metrics?.netFlow ?? 0)}
          icon={DollarSign}
          tone="slate"
          helperText={t("transactions.metrics.consolidatedNetHelper", { defaultValue: "Consolidated operational liquidity balance" })}
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-card border border-border/80 rounded-xl shadow-xs">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("transactions.searchPlaceholder", { defaultValue: "Search by ID, reference, description, or member..." })}
            className="w-full text-xs pl-8 pr-3 rtl:pl-3 rtl:pr-8 py-1.5 rounded-lg border border-border/80 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="w-full sm:w-64">
          <AppDropdown
            value={typeFilter}
            onChange={(val) => onTypeFilterChange(val || "")}
            options={typeOptions}
            placeholder={t("transactions.filterTypePlaceholder", { defaultValue: "Filter by type..." })}
          />
        </div>
      </div>

      {/* Master ERP Table */}
      <ERPDataTable
        columns={columns}
        data={transactions}
        isLoading={isLoading}
        totalCount={totalCount}
        page={currentPage}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        emptyMessage={t("transactions.emptyDescription", {
          defaultValue: "Financial transactions will appear here once deposits, expenses, or transfers are recorded.",
        })}
      />
    </div>
  );
}
