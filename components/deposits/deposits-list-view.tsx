"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, MoreVertical, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPFiscalMonthPicker, type FiscalMonthValue } from "@/components/ui/erp-fiscal-month-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { hasScreenPermission } from "@/lib/permissions";
import { isSuperAdminRole, normalizeRole } from "@/lib/roles";
import { formatDatePattern, formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import {
  depositStatusTone,
  monthKeyOf,
  monthRange,
  recentYears,
  useDepositsList,
  useDepositsMonthlyTotal,
  useFundOptions,
  useMemberOptions,
  useTenantCurrency,
  useTenantDateFormat,
  type DepositRow,
} from "./shared";

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

function MonthLabel({ iso, t }: { iso: string; t: (k: string) => string }) {
  const key = monthKeyOf(iso);
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return <span>—</span>;
  const short = MONTH_SHORT[Number(m[2]) - 1] ?? "jan";
  return (
    <span className="whitespace-nowrap">
      {t(`common.months.${short}`)} {m[1]}
    </span>
  );
}

type ConfirmState =
  | { kind: "verify"; row: DepositRow }
  | { kind: "reject"; row: DepositRow }
  | { kind: "delete"; row: DepositRow }
  | null;

function DepositActionsMenu({
  row,
  canVerify,
  canDelete,
  onView,
  onVerify,
  onReject,
  onDelete,
}: {
  row: DepositRow;
  canVerify: boolean;
  canDelete: boolean;
  onView: () => void;
  onVerify: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pending = (row.status || "").toUpperCase() === "PENDING";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const items = [
    { label: t("deposits.actions.view"), icon: <Eye size={13} />, run: onView, danger: false, show: true },
    { label: t("deposits.actions.verify"), icon: <ShieldCheck size={13} />, run: onVerify, danger: false, show: canVerify && pending },
    { label: t("deposits.actions.reject"), icon: <XCircle size={13} />, run: onReject, danger: false, show: canVerify && pending },
    { label: t("deposits.actions.delete"), icon: <Trash2 size={13} />, run: onDelete, danger: true, show: canDelete },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + window.scrollY + 4, left: Math.max(8, r.right + window.scrollX - 180) });
          setOpen(!open);
        }}
        className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <MoreVertical size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="z-[100] w-[180px] rounded-lg border border-border/80 bg-card shadow-lg py-1"
            style={{ position: "absolute", top: pos.top, left: pos.left }}
          >
            {items
              .filter((i) => i.show)
              .map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.run();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                    item.danger
                      ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      : "text-foreground hover:bg-muted/60"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Deposits management desk: server-filtered directory with verify/reject
// review flow (PENDING → Completed/REJECTED) and admin soft-delete.
export function DepositsListView({ onAdd, onBulk }: { onAdd: () => void; onBulk: () => void }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [month, setMonth] = useState<FiscalMonthValue>({ fiscalYear: null, month: null });
  const [status, setStatus] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [receipt, setReceipt] = useState<DepositRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const range = month.fiscalYear && month.month ? monthRange(`${month.fiscalYear}-${month.month}`) : null;

  const canWrite = hasScreenPermission(user, "DEPOSITS", "WRITE");
  const canDelete =
    isSuperAdminRole(user?.role) || normalizeRole(user?.role) === "Admin";

  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();

  const list = useDepositsList({
    page,
    pageSize,
    search,
    memberId,
    fundId,
    status,
    startDate: range?.start ?? null,
    endDate: range?.end ?? null,
  });

  // Monthly collection badge: server-side SUM aggregate (one row) instead of
  // fetching up to 1000 full deposit rows to add up client-side.
  const nowKey = monthKeyOf(new Date().toISOString());
  const nowRange = monthRange(nowKey);
  const monthly = useDepositsMonthlyTotal(nowRange?.start ?? null, nowRange?.end ?? null);
  const monthlyTotal = monthly.data ?? "0.00";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["deposits"] });

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      apiClient(`/deposits/${id}/${decision}`, { method: "POST" }),
    onSuccess: (_, vars) => {
      invalidate();
      toast.success(t(vars.decision === "approve" ? "deposits.verifiedToast" : "deposits.rejectedToast"));
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/finance/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success(t("deposits.deletedToast"));
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed")),
  });

  // The list API exposes no server sort; headers sort the loaded page
  // client-side (documented fallback, never silently unordered).
  const rows = useMemo(() => {
    const data = [...(list.data?.data ?? [])];
    const dir = sortOrder === "asc" ? 1 : -1;
    const val = (r: DepositRow): string | number => {
      switch (sortBy) {
        case "amount":
          return Number(r.amount) || 0;
        case "memberName":
          return (r.memberName || "").toLowerCase();
        case "fundName":
          return (r.fundName || "").toLowerCase();
        case "status":
          return (r.status || "").toLowerCase();
        case "referenceNumber":
          return (r.referenceNumber || "").toLowerCase();
        default:
          return new Date(r.date).getTime() || 0;
      }
    };
    data.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return data;
  }, [list.data, sortBy, sortOrder]);

  const onSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const statusLabel = (s: string | null | undefined): string => {
    const u = (s || "").toUpperCase();
    if (u === "PENDING") return t("deposits.statusPending");
    if (u === "REJECTED") return t("deposits.statusRejected");
    return t("deposits.statusVerified");
  };

  const columns: ERPColumn<DepositRow>[] = [
    {
      key: "date",
      header: t("deposits.columns.date"),
      sortable: true,
      render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{formatDatePattern(r.date, dateFormat)}</span>,
    },
    {
      key: "referenceNumber",
      header: t("deposits.columns.receipt"),
      sortable: true,
      render: (r) => <span className="font-mono text-[11px]">{r.referenceNumber || "—"}</span>,
    },
    {
      key: "memberName",
      header: t("deposits.columns.member"),
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{r.memberName || "—"}</p>
          {r.memberIdStr && (
            <span className="inline-block mt-0.5 px-1.5 py-px rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-slate-500">
              {r.memberIdStr}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "fundName",
      header: t("deposits.columns.fund"),
      sortable: true,
      render: (r) => <span>{r.fundName || "—"}</span>,
    },
    {
      key: "month",
      header: t("deposits.columns.month"),
      render: (r) => <MonthLabel iso={r.date} t={t} />,
    },
    {
      key: "amount",
      header: t("deposits.columns.amount"),
      sortable: true,
      align: "right",
      render: (r) => <span className="font-mono">{formatMoney(r.amount, currency)}</span>,
    },
    {
      key: "depositMethod",
      header: t("deposits.columns.method"),
      render: (r) => <span className="text-[11px]">{r.depositMethod || "—"}</span>,
    },
    {
      key: "status",
      header: t("deposits.columns.status"),
      sortable: true,
      render: (r) => <StatusBadge tone={depositStatusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>,
    },
    {
      key: "actions",
      header: t("deposits.columns.actions"),
      align: "right",
      render: (r) => (
        <DepositActionsMenu
          row={r}
          canVerify={canWrite}
          canDelete={canDelete}
          onView={() => setReceipt(r)}
          onVerify={() => setConfirm({ kind: "verify", row: r })}
          onReject={() => setConfirm({ kind: "reject", row: r })}
          onDelete={() => setConfirm({ kind: "delete", row: r })}
        />
      ),
    },
  ];

  const memberOptions = (membersQuery.data ?? []).map((m) => ({
    value: m.id,
    label: m.name,
    caption: m.memberId,
  }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const statusOptions = [
    { value: "PENDING", label: t("deposits.statusPending") },
    { value: "Completed", label: t("deposits.statusVerified") },
    { value: "REJECTED", label: t("deposits.statusRejected") },
  ];
  const years = recentYears(5);
  const monthOptions = MONTH_SHORT.map((s, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: t(`common.months.${s}`),
  }));

  const busy = reviewMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("deposits.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("deposits.monthlyCollection")}:{" "}
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
              {monthly.isLoading ? "…" : formatMoney(monthlyTotal, currency)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => list.refetch()} loading={list.isFetching} icon={<RefreshCw size={13} />}>
            {t("deposits.refresh")}
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" icon={<Users size={13} />} onClick={onBulk}>
                {t("deposits.bulkDeposit")}
              </Button>
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onAdd}>
                {t("deposits.addDeposit")}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="relative lg:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("deposits.searchPlaceholder")}
            aria-label={t("deposits.searchPlaceholder")}
            className="w-full bg-card pl-9 pr-3 py-2 rounded-lg border border-border/80 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>
        <AppDropdown
          options={memberOptions}
          value={memberId}
          onChange={(v) => {
            setMemberId(v);
            setPage(1);
          }}
          placeholder={t("deposits.allMembers")}
        />
        <AppDropdown
          options={fundOptions}
          value={fundId}
          onChange={(v) => {
            setFundId(v);
            setPage(1);
          }}
          placeholder={t("deposits.allFunds")}
        />
        <AppDropdown
          options={statusOptions}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          placeholder={t("deposits.allStatuses")}
        />
      </div>

      <ERPFiscalMonthPicker
        fiscalYears={years}
        months={monthOptions}
        value={month}
        onChange={(v) => {
          setMonth(v);
          setPage(1);
        }}
      />

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
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        emptyMessage={list.isError ? t("deposits.loadFailed") : t("common.noData")}
        emptyAction={
          canWrite && !list.isError ? (
            <Button variant="outline" size="sm" icon={<Plus size={13} />} onClick={onAdd}>
              {t("deposits.addDeposit")}
            </Button>
          ) : undefined
        }
      />

      <TopSheet
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title={t("deposits.receiptTitle")}
        subtitle={receipt?.referenceNumber || undefined}
      >
        {receipt && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {[
              [t("deposits.columns.date"), formatDatePattern(receipt.date, dateFormat, true)],
              [t("deposits.columns.member"), `${receipt.memberName || "—"}${receipt.memberIdStr ? ` (${receipt.memberIdStr})` : ""}`],
              [t("deposits.columns.fund"), receipt.fundName || "—"],
              [t("deposits.columns.amount"), formatMoney(receipt.amount, currency)],
              [t("deposits.columns.method"), receipt.depositMethod || "—"],
              [t("deposits.columns.month"), monthKeyOf(receipt.date)],
              [t("deposits.modal.cashier"), receipt.handlingOfficer || "—"],
              [t("deposits.modal.notes"), receipt.description || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
                <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-400">{t("deposits.columns.status")}</dt>
              <dd className="mt-0.5">
                <StatusBadge tone={depositStatusTone(receipt.status)}>{statusLabel(receipt.status)}</StatusBadge>
              </dd>
            </div>
          </dl>
        )}
      </TopSheet>

      <ERPConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "verify"
            ? t("deposits.verifyTitle")
            : confirm?.kind === "reject"
              ? t("deposits.rejectTitle")
              : t("deposits.deleteTitle")
        }
        description={
          confirm?.kind === "verify"
            ? t("deposits.verifyMessage", { amount: formatMoney(confirm.row.amount, currency), member: confirm.row.memberName || "" })
            : confirm?.kind === "reject"
              ? t("deposits.rejectMessage", { amount: formatMoney(confirm.row.amount, currency), member: confirm.row.memberName || "" })
              : t("deposits.deleteMessage", { ref: confirm?.row.referenceNumber || "" })
        }
        confirmLabel={
          confirm?.kind === "verify"
            ? t("deposits.actions.verify")
            : confirm?.kind === "reject"
              ? t("deposits.actions.reject")
              : t("deposits.actions.delete")
        }
        cancelLabel={t("common.cancel")}
        confirmVariant={confirm?.kind === "verify" ? "primary" : "destructive"}
        pending={busy}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "delete") deleteMutation.mutate(confirm.row.id);
          else reviewMutation.mutate({ id: confirm.row.id, decision: confirm.kind === "verify" ? "approve" : "reject" });
        }}
      />

    </div>
  );
}
