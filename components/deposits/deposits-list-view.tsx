"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, MoreVertical, Pencil, Plus, Printer, RefreshCw, Search, ShieldCheck, Trash2, Undo2, Users, XCircle } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
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
import { offerPrintDocument, openPrintTab } from "@/lib/documents";
import { hasScreenPermission } from "@/lib/permissions";
import { isSuperAdminRole, normalizeRole } from "@/lib/roles";
import { formatDateOnly, formatDatePattern, formatMoney } from "@/lib/formatters";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useFiscalYearSync } from "@/lib/fiscal-year-context";
import { useLocale } from "@/lib/i18n";
import { memberDisplayName } from "@/lib/member-display";
import {
  depositStatusTone,
  monthKeyOf,
  monthRange,
  useDepositsList,
  useDepositsMonthlyTotal,
  useFundOptions,
  useMemberOptions,
  useTenantCurrency,
  useTenantDateFormat,
  type DepositRow,
} from "./shared";
import { ledgerRef } from "@/lib/doc-number";

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

function MonthLabel({ monthKey, t }: { monthKey: string; t: (k: string) => string }) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
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
  | { kind: "revert"; row: DepositRow }
  | null;

function DepositActionsMenu({
  row,
  canVerify,
  canEdit,
  canDelete,
  canRevert,
  onView,
  onEdit,
  onVerify,
  onReject,
  onRevert,
  onDelete,
}: {
  row: DepositRow;
  canVerify: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRevert: boolean;
  onView: () => void;
  onEdit: () => void;
  onVerify: () => void;
  onReject: () => void;
  onRevert: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pending = (row.status || "").toUpperCase() === "PENDING";
  const completed = (row.status || "").toUpperCase() === "COMPLETED" || (row.status || "").toUpperCase() === "SUCCESS";

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
    { label: t("deposits.actions.print", { defaultValue: "Print Receipt" }), icon: <Printer size={13} />, run: () => openPrintTab("deposit", row.id), danger: false, show: true },
    { label: t("deposits.actions.edit"), icon: <Pencil size={13} />, run: onEdit, danger: false, show: canEdit },
    { label: t("deposits.actions.verify"), icon: <ShieldCheck size={13} />, run: onVerify, danger: false, show: canVerify && pending },
    { label: t("deposits.actions.reject"), icon: <XCircle size={13} />, run: onReject, danger: false, show: canVerify && pending },
    { label: t("deposits.actions.revert"), icon: <Undo2 size={13} />, run: onRevert, danger: false, show: canRevert && completed },
    // Completed deposits cannot be deleted — they must revert first (§12).
    { label: t("deposits.actions.delete"), icon: <Trash2 size={13} />, run: onDelete, danger: true, show: canDelete && !completed },
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

/**
 * Member self-scope for the Request Deposit screen. When present the screen
 * renders with the deposits layout but is locked to one member: no
 * edit/revert/delete, the member filter shows (or resolves to) that member
 * only, and verify/reject stay hidden (plain members cannot review). The bulk
 * action IS available here — it submits batch deposit REQUESTS (PENDING slips
 * for officer approval) scoped to the signed-in member, not direct deposits.
 * Officers (DEPOSITS READ) pass NO scope and get the open request inbox:
 * every member's requests, with verify/reject on pending rows.
 */
export interface DepositsMemberScope {
  /** Member uuid; null while it is still being resolved (filter stays open). */
  id: string | null;
  name?: string | null;
}

// Deposits management desk: server-filtered directory with verify/reject
// review flow (PENDING → Completed/REJECTED) for direct (non-request) pending
// deposits, edit via the finance service (atomic fund/member reversal), revert
// Completed → PENDING with reversal, and soft-delete for non-Completed only.
// PENDING deposit REQUESTS are excluded from this desk (excludePendingRequests)
// — they live on the Request Deposit screen. The Request Deposit screen
// reuses this component with requestScreen: members self-scoped, officers as
// the request inbox, so both screens share one UI.
export function DepositsListView({
  onAdd,
  onBulk,
  onEdit,
  memberScope,
  requestScreen = false,
}: {
  onAdd: () => void;
  onBulk?: () => void;
  onEdit?: (row: DepositRow) => void;
  memberScope?: DepositsMemberScope;
  /**
   * Renders the Request Deposit screen (submit + track/review requests).
   * Officers (DEPOSITS READ) get an inbox of ALL requests; members stay
   * scoped to their own. The desk (default) hides PENDING deposit requests —
   * they only exist on this screen.
   */
  requestScreen?: boolean;
}) {
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
  // Default newest-first on the COLLECTED date (transactions.date) — the
  // business-meaningful "latest" for a deposit desk (AGENTS.md §2: finance
  // lists sort by `date`, not `createdAt`). The Date column renders this same
  // field, so the ordering and the visible dates always agree.
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [receipt, setReceipt] = useState<DepositRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const range = month.month ? monthRange(month.month) : null;

  const scopedMemberId = memberScope?.id ?? null;
  const selfOnly = !!memberScope;
  // Scope id resolves after first render (email → member match), so it is
  // derived, never seeded into state.
  const lockedMember = selfOnly && !!scopedMemberId;
  const filterMemberId = selfOnly ? scopedMemberId ?? memberId : memberId;

  const canWrite = hasScreenPermission(user, "DEPOSITS", "WRITE");
  // Submit-a-request permission (member-facing action), separate from the
  // desk's DEPOSITS WRITE. On the request screen the add/bulk buttons need
  // this; review (verify/reject) stays gated on DEPOSITS WRITE, which plain
  // members do not hold, so nobody can approve their own request (§6).
  const canRequest = hasScreenPermission(user, "REQUEST_DEPOSIT", "WRITE");
  const canAct = requestScreen ? canRequest : canWrite;
  const canVerify = canWrite;
  const canEdit = !selfOnly && canWrite;
  // Revert/delete are desk-only operations on settled deposits — never on the
  // request screen, whose rows are requests (pending ones get rejected, not
  // deleted; completed ones are reviewed on the desk).
  const canRevert = !selfOnly && !requestScreen && canWrite;
  const canDelete =
    !selfOnly && !requestScreen && (isSuperAdminRole(user?.role) || normalizeRole(user?.role) === "Admin");
  // Status is review-flow info — Admin/Manager-only per user spec (2026-10-04;
  // corrected same day: Manager, not Member): Member/Auditor render the
  // directory without the Status column. Fail-closed while the user hydrates.
  const showStatusColumn =
    !!user && (normalizeRole(user.role) === "Admin" || normalizeRole(user.role) === "Manager");

  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();

  // Month filter matches the month a deposit is FOR (the Month column's
  // value), not the collected date — back-entered deposits appear under the
  // month they were selected for. The picker's month value is already the
  // absolute YYYY-MM of the chosen fiscal month, so it goes on the wire as-is.
  const pickedMonthKey = month.month;

  const list = useDepositsList({
    page,
    pageSize,
    search,
    memberId: filterMemberId,
    fundId,
    status,
    startDate: range?.start ?? null,
    endDate: range?.end ?? null,
    monthKey: pickedMonthKey,
    // The desk hides PENDING deposit REQUESTS — they live on the Request
    // Deposit screen's inbox, where they are submitted and reviewed. The
    // request screen passes requestScreen and sees everything.
    excludePendingRequests: !requestScreen,
    sortBy,
    sortOrder,
  });

  // Monthly collection badge: server-side SUM aggregate (one row) instead of
  // fetching up to 1000 full deposit rows to add up client-side.
  // Current month key in the VIEWER'S local timezone. Deriving it from
  // `new Date().toISOString()` would key off the UTC month, so a user in a
  // positive-offset timezone would see the wrong "this month" total on the
  // last day of the month (report issue 18).
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nowRange = monthRange(nowKey);
  const monthly = useDepositsMonthlyTotal(
    nowRange?.start ?? null,
    nowRange?.end ?? null,
    selfOnly ? filterMemberId : null,
  );
  const monthlyTotal = monthly.data ?? "0.00";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["deposits"] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["funds"] });
    // Analysis is built from these ledger rows — without this, approving /
    // rejecting / reverting a deposit left its cached chart + regularity
    // matrix stale for up to staleTime (60s).
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
  };

  const closeConfirm = () => {
    setConfirm(null);
    setReason("");
    setReasonError(false);
  };

  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: "approve" | "reject"; reason?: string }) =>
      apiClient(`/deposits/${id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "reject" ? { rejectionReason: reason } : {}),
      }),
    onSuccess: (_, vars) => {
      invalidate();
      const decided = t(vars.decision === "approve" ? "deposits.verifiedToast" : "deposits.rejectedToast");
      closeConfirm();
      // The deposit has just settled, so its receipt is offered — but only now,
      // and only if the officer wants it. Approval and paper issue are separate
      // decisions.
      if (vars.decision === "approve") {
        offerPrintDocument({
          kind: "deposit",
          id: vars.id,
          title: decided,
          actionLabel: t("deposits.actions.print", { defaultValue: "Print Receipt" }),
        });
      } else {
        toast.success(decided);
      }
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient(`/transactions/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      invalidate();
      toast.success(t("deposits.deletedToast"));
      closeConfirm();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed")),
  });

  const revertMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient(`/deposits/${id}/revert`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      invalidate();
      toast.success(t("deposits.revertedToast"));
      closeConfirm();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed")),
  });

  // Ordering is the server's job: the desk paginates a filtered set that can be
  // thousands of rows, so sorting only the loaded page reorders 20 of them and
  // looks like a dead header (AGENTS.md §2).
  const rows = list.data?.data ?? [];

  const onSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder("asc");
    }
    // A new order is a new result set — never stay deep in the old one.
    setPage(1);
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
      render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{formatDateOnly(r.date, dateFormat)}</span>,
    },
    {
      key: "referenceNumber",
      header: t("deposits.columns.receipt"),
      sortable: true,
      render: (r) => <span className="font-mono text-[11px]">{ledgerRef(r)}</span>,
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
      // The month the deposit is FOR (explicitly selected in the form) —
      // collected date is only the fallback for rows without one.
      render: (r) => <MonthLabel monthKey={r.depositMonth || monthKeyOf(r.date)} t={t} />,
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
          canVerify={canVerify}
          canEdit={canEdit && !!onEdit}
          canDelete={canDelete}
          canRevert={canRevert}
          onView={() => setReceipt(r)}
          onEdit={() => onEdit?.(r)}
          onVerify={() => setConfirm({ kind: "verify", row: r })}
          onReject={() => {
            setReason("");
            setReasonError(false);
            setConfirm({ kind: "reject", row: r });
          }}
          onRevert={() => {
            setReason("");
            setReasonError(false);
            setConfirm({ kind: "revert", row: r });
          }}
          onDelete={() => {
            setReason("");
            setReasonError(false);
            setConfirm({ kind: "delete", row: r });
          }}
        />
      ),
    },
  ];

  const tableColumns = showStatusColumn ? columns : columns.filter((c) => c.key !== "status");

  const allMemberOptions = (membersQuery.data ?? []).map((m) => ({
    value: m.id,
    label: memberDisplayName(m.name, m.status),
    caption: m.memberId,
  }));
  // Locked scope shows only its own member — no hidden directory of everyone.
  const memberOptions = lockedMember
    ? allMemberOptions.filter((o) => o.value === scopedMemberId)
    : allMemberOptions;
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const statusOptions = [
    { value: "PENDING", label: t("deposits.statusPending") },
    { value: "Completed", label: t("deposits.statusVerified") },
    { value: "REJECTED", label: t("deposits.statusRejected") },
  ];
  // Period filter options come from the tenant's fiscal calendar (§8), so the
  // desk filters by the same FY periods the forms record against.
  // A READ screen: the filter offers every created year (Open and Closed),
  // because the header's fiscal-year selector can point at a closed year and
  // its history is exactly what the desk filters for. Posting forms stay on the
  // OPEN-only `yearOptions`.
  const { yearOptionsAll: yearOptions, monthsFor } = useFiscalPeriodOptions();

  // Header year is the app-wide period: when it moves, this filter follows it
  // and drops any month picked in the previous year — a filter that kept
  // pointing at 2025-11 while the header reads FY 2026-27 would silently show
  // an empty list. The month stays unset, so the filter never narrows on its own.
  const syncHeaderYear = useCallback((year: string | null) => {
    setMonth((prev) => (prev.fiscalYear === year ? prev : { fiscalYear: year, month: null }));
    setPage(1);
  }, []);
  useFiscalYearSync(syncHeaderYear);

  const monthOptions = monthsFor(month.fiscalYear);

  const busy = reviewMutation.isPending || deleteMutation.isPending || revertMutation.isPending;
  const needsReason = confirm?.kind === "reject" || confirm?.kind === "delete" || confirm?.kind === "revert";
  // Request-screen vocabulary (titles, button labels, empty state) applies to
  // the member-scoped view AND to the officer inbox — both render the request
  // screen, only the row scope differs.
  const isRequestView = requestScreen || selfOnly;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {isRequestView ? t("requestDeposit.title") : t("deposits.title")}
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
          {canAct && (
            <>
              {onBulk && (
                <Button variant="outline" size="sm" icon={<Users size={13} />} onClick={onBulk}>
                  {isRequestView ? t("requestDeposit.bulkRequest") : t("deposits.bulkDeposit")}
                </Button>
              )}
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onAdd}>
                {isRequestView ? t("requestDeposit.title") : t("deposits.addDeposit")}
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
          value={filterMemberId}
          onChange={(v) => {
            setMemberId(v);
            setPage(1);
          }}
          placeholder={lockedMember ? memberScope?.name ?? t("deposits.allMembers") : t("deposits.allMembers")}
          disabled={lockedMember}
          clearable={!lockedMember}
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
        fiscalYears={yearOptions}
        months={monthOptions}
        value={month}
        onChange={(v) => {
          setMonth(v);
          setPage(1);
        }}
      />

      <ERPDataTable
        data={rows}
        columns={tableColumns}
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
        emptyMessage={
          list.isError
            ? t("deposits.loadFailed")
            : isRequestView
              ? t("requestDeposit.emptyHistory")
              : t("common.noData")
        }
        emptyAction={
          canAct && !list.isError ? (
            <Button variant="outline" size="sm" icon={<Plus size={13} />} onClick={onAdd}>
              {isRequestView ? t("requestDeposit.title") : t("deposits.addDeposit")}
            </Button>
          ) : undefined
        }
      />

      <TopSheet
        open={receipt !== null}
        onClose={() => setReceipt(null)}
        title={t("deposits.receiptTitle")}
          subtitle={ledgerRef(receipt, "") || undefined}
      >
        {receipt && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {[
              [t("deposits.modal.collectedDate"), formatDateOnly(receipt.date, dateFormat)],
              [t("deposits.modal.submittedDate"), receipt.submittedDate ? formatDatePattern(receipt.submittedDate, dateFormat, true) : "—"],
              [t("deposits.columns.member"), `${receipt.memberName || "—"}${receipt.memberIdStr ? ` (${receipt.memberIdStr})` : ""}`],
              [t("deposits.columns.fund"), receipt.fundName || "—"],
              [t("deposits.columns.amount"), formatMoney(receipt.amount, currency)],
              [t("deposits.columns.method"), receipt.depositMethod || "—"],
              [t("deposits.columns.month"), receipt.depositMonth || monthKeyOf(receipt.date)],
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
              : confirm?.kind === "revert"
                ? t("deposits.revertTitle")
                : t("deposits.deleteTitle")
        }
        description={
          confirm?.kind === "verify"
            ? t("deposits.verifyMessage", { amount: formatMoney(confirm.row.amount, currency), member: confirm.row.memberName || "" })
            : confirm?.kind === "reject"
              ? t("deposits.rejectMessage", { amount: formatMoney(confirm.row.amount, currency), member: confirm.row.memberName || "" })
              : confirm?.kind === "revert"
                ? t("deposits.revertMessage", { amount: formatMoney(confirm.row.amount, currency), member: confirm.row.memberName || "" })
                : t("deposits.deleteMessage", { ref: ledgerRef(confirm?.row, "") })
        }
        confirmLabel={
          confirm?.kind === "verify"
            ? t("deposits.actions.verify")
            : confirm?.kind === "reject"
              ? t("deposits.actions.reject")
              : confirm?.kind === "revert"
                ? t("deposits.actions.revert")
                : t("deposits.actions.delete")
        }
        cancelLabel={t("common.cancel")}
        confirmVariant={confirm?.kind === "verify" || confirm?.kind === "revert" ? "primary" : "destructive"}
        pending={busy}
        extra={
          needsReason && confirm ? (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500" htmlFor="deposit-reason">
                {confirm.kind === "revert" ? t("deposits.revertReason") : confirm.kind === "reject" ? t("deposits.rejectReason") : t("deposits.deleteReason")}
              </label>
              <textarea
                id="deposit-reason"
                autoFocus
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(false);
                }}
                rows={3}
                placeholder={t("deposits.reasonPlaceholder")}
                className="mt-1.5 w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
              {reasonError && (
                <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                  {t("deposits.reasonRequired")}
                </p>
              )}
            </div>
          ) : undefined
        }
        onClose={() => {
          if (!busy) closeConfirm();
        }}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "verify") {
            // No window is pre-opened here: the receipt is offered on the
            // success toast, so cancelling or failing the approval can no longer
            // leave a stray print tab behind.
            reviewMutation.mutate({ id: confirm.row.id, decision: "approve" });
            return;
          }
          if (!reason.trim()) {
            setReasonError(true);
            return;
          }
          if (confirm.kind === "reject") reviewMutation.mutate({ id: confirm.row.id, decision: "reject", reason: reason.trim() });
          else if (confirm.kind === "revert") revertMutation.mutate({ id: confirm.row.id, reason: reason.trim() });
          else deleteMutation.mutate({ id: confirm.row.id, reason: reason.trim() });
        }}
      />

    </div>
  );
}
