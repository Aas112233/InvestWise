"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { usePermissions } from "@/lib/use-permissions";
import { useAuth } from "@/lib/auth-context";
import { normalizeRole, isSuperAdminRole } from "@/lib/roles";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { sumCents, centsToAmount, useTenantCurrency } from "@/components/deposits/shared";
import { FundModal } from "./fund-modal";
import { FundTransferModal } from "./fund-transfer-modal";
import { fundTypeLabelKey, useFundsList, type FundRow } from "./shared";

const TYPE_FILTERS = ["DEPOSIT", "PRIMARY", "PROJECT", "RESERVE", "EMERGENCY", "OTHER"] as const;

// Treasury overview: KPI cards computed in integer cents from the loaded
// fund set, plus the fund directory table with edit/transfer actions.
export function FundsView() {
  const { t } = useLocale();
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [fundModalOpen, setFundModalOpen] = useState(false);
  const [editing, setEditing] = useState<FundRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSource, setTransferSource] = useState<string | null>(null);

  const currency = useTenantCurrency();
  const list = useFundsList({ type: typeFilter, status: statusFilter });

  // Write-gated via the shared evaluator (role baseline + overrides), not a
  // raw role check — Managers carry FUNDS_MANAGEMENT WRITE by baseline.
  const canWrite = can("FUNDS_MANAGEMENT", "WRITE");

  const funds = list.data?.data ?? [];
  const active = funds.filter((f) => (f.status || "ACTIVE") === "ACTIVE");
  const totalCents = sumCents(active.map((f) => f.balance));
  const operatingCents = sumCents(
    active.filter((f) => (f.type || "OTHER") !== "PROJECT").map((f) => f.balance),
  );
  const bufferCents = sumCents(active.map((f) => f.minimumBalance));
  const reserveRatio = totalCents > 0 ? (bufferCents / totalCents) * 100 : 0;

  const typeOptions = TYPE_FILTERS.map((v) => ({ value: v, label: t(fundTypeLabelKey(v)) }));
  const statusOptions = [
    { value: "ACTIVE", label: t("common.active") },
    { value: "INACTIVE", label: t("members.statusLabels.inactive") },
    { value: "CLOSED", label: t("funds.statusArchived") },
  ];

  const statusTone = (s: string | null | undefined): "emerald" | "slate" | "amber" => {
    const u = (s || "ACTIVE").toUpperCase();
    if (u === "ACTIVE") return "emerald";
    if (u === "CLOSED") return "slate";
    return "amber";
  };

  const columns: ERPColumn<FundRow>[] = [
    {
      key: "name",
      header: t("funds.columns.name"),
      render: (f) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{f.name}</p>
          {f.accountNumber && <p className="font-mono text-[10px] text-slate-400">{f.accountNumber}</p>}
        </div>
      ),
    },
    {
      key: "type",
      header: t("funds.columns.type"),
      render: (f) => <StatusBadge tone="cyan">{t(fundTypeLabelKey(f.type))}</StatusBadge>,
    },
    {
      key: "balance",
      header: t("funds.columns.balance"),
      align: "right",
      render: (f) => <span className="font-mono">{formatMoney(f.balance, f.currency || currency)}</span>,
    },
    {
      key: "minimumBalance",
      header: t("funds.columns.minBuffer"),
      align: "right",
      render: (f) => <span className="font-mono">{formatMoney(f.minimumBalance ?? 0, f.currency || currency)}</span>,
    },
    {
      key: "status",
      header: t("funds.columns.status"),
      render: (f) => (
        <StatusBadge tone={statusTone(f.status)}>
          {(f.status || "ACTIVE") === "ACTIVE"
            ? t("common.active")
            : (f.status || "") === "CLOSED"
              ? t("funds.statusArchived")
              : t("members.statusLabels.inactive")}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: t("funds.columns.actions"),
      align: "right",
      render: (f) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && (
            <button
              type="button"
              aria-label={t("funds.actions.edit")}
              title={t("funds.actions.edit")}
              onClick={() => {
                setEditing(f);
                setFundModalOpen(true);
              }}
              className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              aria-label={t("funds.actions.transfer")}
              title={t("funds.actions.transfer")}
              onClick={() => {
                setTransferSource(f.id);
                setTransferOpen(true);
              }}
              className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowLeftRight size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("funds.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("funds.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["funds"] })}
            loading={list.isFetching}
            icon={<RefreshCw size={13} />}
          >
            {t("funds.refresh")}
          </Button>
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setFundModalOpen(true);
              }}
            >
              {t("funds.newFund")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ERPMetricCard label={t("funds.totalTreasury")} value={formatMoney(centsToAmount(totalCents), currency)} currency={currency} />
        <ERPMetricCard label={t("funds.operatingLiquidity")} value={formatMoney(centsToAmount(operatingCents), currency)} currency={currency} />
        <ERPMetricCard label={t("funds.reserveRatio")} value={`${reserveRatio.toFixed(2)}%`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
        <AppDropdown
          options={typeOptions}
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder={t("funds.columns.type")}
        />
        <AppDropdown
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder={t("funds.columns.status")}
        />
      </div>

      <ERPDataTable
        data={funds}
        columns={columns}
        isLoading={list.isLoading}
        rowKey={(f) => f.id}
        emptyMessage={list.isError ? t("funds.loadFailed") : t("common.noData")}
        emptyAction={
          canWrite && !list.isError ? (
            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => {
                setEditing(null);
                setFundModalOpen(true);
              }}
            >
              {t("funds.newFund")}
            </Button>
          ) : undefined
        }
      />

      <FundModal
        open={fundModalOpen}
        initial={editing}
        onClose={() => {
          setFundModalOpen(false);
          setEditing(null);
        }}
      />
      <FundTransferModal
        open={transferOpen}
        funds={funds}
        presetSourceId={transferSource}
        onClose={() => {
          setTransferOpen(false);
          setTransferSource(null);
        }}
      />
    </div>
  );
}
