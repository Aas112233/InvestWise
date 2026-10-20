"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { centsToAmount, sumCents, useTenantCurrency, useTenantDateFormat } from "@/components/deposits/shared";
import { PayoutCreateModal } from "./payout-create-modal";
import { PayoutDetailSheet } from "./payout-detail-sheet";
import { usePayoutList, type PayoutPlan } from "./shared";
import { formatDatePattern, formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { usePermissions } from "@/lib/use-permissions";

const STATUS_OPTIONS = ["ACTIVE", "COMPLETED", "CANCELLED"];

/**
 * Suspended-member payouts: one row per exit settlement, with its phases and
 * what is still owed. Cash leaves a fund only from a plan's detail sheet, when
 * an officer confirms a handover.
 */
export function PayoutsView() {
  const { t } = useLocale();
  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const { can } = usePermissions();
  const canWrite = can("PAYOUTS", "WRITE");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Debounced free-text search, same 400ms rhythm as the deposits desk.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  const list = usePayoutList({ page, pageSize, search, status, sortBy, sortOrder });
  const rows = list.data?.data ?? [];

  // KPIs come from the loaded page only — deliberate: the money figures that
  // must be exact (reserved / paid) are read from each plan server-side, and a
  // page-local roll-up would silently disagree with other pages.
  const kpis = useMemo(() => {
    const open = rows.filter((r) => r.status === "ACTIVE");
    return {
      openCount: open.length,
      reservedCents: sumCents(open.map((r) => r.remainingAmount)),
      paidCents: sumCents(rows.map((r) => r.paidAmount)),
      dueNow: open.filter((r) => r.nextDue?.isDue).length,
    };
  }, [rows]);

  const onSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const columns: ERPColumn<PayoutPlan>[] = [
    {
      key: "memberName",
      header: t("payouts.column.member", { defaultValue: "Member" }),
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{r.memberName ?? "—"}</p>
          <p className="font-mono text-[10px] text-slate-400">{r.memberCode}</p>
        </div>
      ),
    },
    {
      key: "totalAmount",
      header: t("payouts.column.total", { defaultValue: "Settlement total" }),
      align: "right",
      sortable: true,
      render: (r) => <span className="font-mono">{formatMoney(r.totalAmount, currency)}</span>,
    },
    {
      key: "paidAmount",
      header: t("payouts.column.paid", { defaultValue: "Paid" }),
      align: "right",
      render: (r) => <span className="font-mono text-slate-500">{formatMoney(r.paidAmount, currency)}</span>,
    },
    {
      key: "remainingAmount",
      header: t("payouts.column.remaining", { defaultValue: "Remaining" }),
      align: "right",
      render: (r) => (
        <span className={`font-mono ${Number(r.remainingAmount) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
          {formatMoney(r.remainingAmount, currency)}
        </span>
      ),
    },
    {
      key: "schedule",
      header: t("payouts.column.schedule", { defaultValue: "Schedule" }),
      render: (r) => (
        <span className="text-xs text-slate-500">
          {r.installmentCount === 1
            ? t("payouts.oneTime", { defaultValue: "One-time" })
            : t("payouts.phased", {
                count: r.installmentCount,
                interval: r.intervalMonths,
                defaultValue: `${r.installmentCount} × every ${r.intervalMonths} mo`,
              })}
        </span>
      ),
    },
    {
      key: "firstDueDate",
      header: t("payouts.column.nextDue", { defaultValue: "Next due" }),
      sortable: true,
      render: (r) =>
        r.nextDue ? (
          <div className="flex items-center gap-2">
            <span className="text-xs">{formatDatePattern(r.nextDue.dueDate, dateFormat)}</span>
            {r.status === "ACTIVE" && r.nextDue.isDue && (
              <StatusBadge tone="rose">{t("payouts.dueNow", { defaultValue: "Due" })}</StatusBadge>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: "fundName",
      header: t("payouts.column.fund", { defaultValue: "Paid from" }),
      render: (r) => <span className="text-xs text-slate-500">{r.fundName ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("payouts.column.status", { defaultValue: "Status" }),
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusBadge tone={r.status === "ACTIVE" ? "amber" : r.status === "COMPLETED" ? "emerald" : "slate"}>
            {t(`payouts.status.${r.status}`, { defaultValue: r.status })}
          </StatusBadge>
          {r.awaitingProjectSettlement && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              {t("payouts.awaitingShort", { defaultValue: "project return pending" })}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setDetailId(r.id)}>
          {t("payouts.open", { defaultValue: "Open" })}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t("payouts.title", { defaultValue: "Member payouts" })}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {t("payouts.subtitle", { defaultValue: "Exit settlements for suspended members, one time or in phases." })}
          </p>
        </div>
        {canWrite && (
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>
            {t("payouts.newPlan", { defaultValue: "New payout plan" })}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("payouts.kpi.openPlans", { defaultValue: "Open plans (this page)" })}
          value={String(kpis.openCount)}
          tone={kpis.openCount > 0 ? "amber" : "slate"}
        />
        <ERPMetricCard
          label={t("payouts.kpi.dueNow", { defaultValue: "Due now" })}
          value={String(kpis.dueNow)}
          tone={kpis.dueNow > 0 ? "rose" : "slate"}
        />
        <ERPMetricCard
          label={t("payouts.kpi.reserved", { defaultValue: "Still owed" })}
          value={formatMoney(centsToAmount(kpis.reservedCents), currency)}
          currency={currency}
        />
        <ERPMetricCard
          label={t("payouts.kpi.paid", { defaultValue: "Paid (this page)" })}
          value={formatMoney(centsToAmount(kpis.paidCents), currency)}
          currency={currency}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("payouts.searchPlaceholder", { defaultValue: "Search by member name, ID or reason…" })}
            aria-label={t("payouts.searchPlaceholder", { defaultValue: "Search payouts" })}
            className="w-full bg-card pl-9 pr-3 py-2 rounded-lg border border-border/80 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <AppDropdown
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: t(`payouts.status.${s}`, { defaultValue: s }) }))}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          placeholder={t("payouts.allStatuses", { defaultValue: "All statuses" })}
          clearable
        />
      </div>

      <ERPDataTable
        data={rows}
        columns={columns}
        isLoading={list.isLoading}
        loadingRowCount={pageSize}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
        rowKey={(r) => r.id}
        page={page}
        pageSize={pageSize}
        totalCount={list.data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={
          list.isError
            ? t("payouts.loadFailed", { defaultValue: "Could not load payouts." })
            : t("payouts.empty", { defaultValue: "No payout plans yet." })
        }
      />

      <PayoutCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <PayoutDetailSheet planId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
