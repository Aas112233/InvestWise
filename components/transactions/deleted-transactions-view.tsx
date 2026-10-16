"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterX, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AppDropdown,
  Button,
  ERPDataTable,
  Input,
  TopSheet,
  type ERPColumn,
} from "@/components/ui";
import { ERPDatePicker } from "@/components/ui/erp-date-picker";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDateOnly, formatDatePattern } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { useFormatMoney, useTenantDateFormat } from "@/lib/use-tenant-settings";
import { getTransactionTypeLabel } from "./shared";

interface DeletedTransactionsResponse {
  data: DeletedTransactionRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface MemberOptionRow {
  id: string;
  name: string;
  memberId: string;
}

export interface DeletedTransactionRow {
  id: string;
  referenceNumber?: string | null;
  date?: string | null;
  type: string;
  category?: string | null;
  amount: number | string;
  status?: string | null;
  description?: string | null;
  memberId?: string | null;
  memberName?: string | null;
  memberCode?: string | null;
  fundId?: string | null;
  fundName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  depositMethod?: string | null;
  handlingOfficer?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletedByName?: string | null;
  deletionReason?: string | null;
  createdAt?: string;
}

/**
 * Admin recovery desk for soft-deleted transactions.
 *
 * Server-driven filters/sort/pagination over GET /api/transactions/deleted
 * (Rule §7 hierarchical key). Restore re-applies the money effect the delete
 * reversed — the API refuses if the fiscal period is closed or the fund would
 * breach its minimum reserve, and surfaces that message verbatim (§11).
 */
export function DeletedTransactionsView() {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const dateFormat = useTenantDateFormat();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const [restoreTarget, setRestoreTarget] = useState<DeletedTransactionRow | null>(null);
  const [restoreReason, setRestoreReason] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const membersQuery = useQuery({
    queryKey: ["members", "dropdown"],
    queryFn: () =>
      apiClient<{ data: MemberOptionRow[] }>("/members", { params: { page: 1, limit: 500 } }),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ["transactions", "deleted", { page, pageSize, search, type, memberId, fromDate, toDate }],
    queryFn: () =>
      apiClient<DeletedTransactionsResponse>("/transactions/deleted", {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          type: type || undefined,
          memberId: memberId || undefined,
          startDate: fromDate || undefined,
          endDate: toDate || undefined,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  const restoreMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient(`/transactions/deleted/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(t("transactions.deleted.restoreSuccess"));
      setRestoreTarget(null);
      setRestoreReason("");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : t("transactions.deleted.restoreFailed"));
    },
  });

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setType(null);
    setMemberId(null);
    setFromDate(null);
    setToDate(null);
    setPage(1);
  };
  const hasFilters =
    search !== "" || type !== null || memberId !== null || fromDate !== null || toDate !== null;

  const typeOptions = [
    { value: "Deposit", label: t("transactions.typeDeposit") },
    { value: "Expense", label: t("transactions.typeExpense") },
    { value: "Dividend", label: t("transactions.typeDividend") },
    { value: "Earning", label: t("transactions.typeEarning") },
    { value: "Transfer In", label: t("transactions.deleted.typeTransferIn") },
    { value: "Transfer Out", label: t("transactions.deleted.typeTransferOut") },
  ];

  const memberOptions = (membersQuery.data?.data ?? []).map((m) => ({
    value: m.id,
    label: `${m.name} · ${m.memberId}`,
  }));

  const rows = query.data?.data ?? [];
  const total = query.data?.pagination?.total ?? 0;

  const columns: ERPColumn<DeletedTransactionRow>[] = [
    {
      key: "deletedAt",
      header: t("transactions.deleted.deletedAt"),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-[11px] whitespace-nowrap">
          {row.deletedAt ? formatDatePattern(row.deletedAt, dateFormat, true) : "—"}
        </span>
      ),
    },
    {
      key: "referenceNumber",
      header: t("transactions.refHeader"),
      render: (row) => (
        <span className="font-mono text-[11px]">{row.referenceNumber || row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: "date",
      header: t("transactions.date"),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-[11px] whitespace-nowrap">
          {row.date ? formatDateOnly(row.date, dateFormat) : "—"}
        </span>
      ),
    },
    {
      key: "type",
      header: t("transactions.type"),
      sortable: true,
      render: (row) => <span className="text-xs">{getTransactionTypeLabel(row.type, t)}</span>,
    },
    {
      key: "memberName",
      header: t("transactions.deleted.member"),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs text-foreground truncate">{row.memberName || "—"}</p>
          {row.memberCode && (
            <span className="font-mono text-[10px] text-muted-foreground">{row.memberCode}</span>
          )}
        </div>
      ),
    },
    {
      key: "fundName",
      header: t("transactions.deleted.fund"),
      render: (row) => <span className="text-xs">{row.fundName || "—"}</span>,
    },
    {
      key: "amount",
      header: t("transactions.amount"),
      sortable: true,
      align: "right",
      render: (row) => <span className="font-mono text-xs font-semibold">{formatMoney(row.amount)}</span>,
    },
    {
      key: "deletedByName",
      header: t("transactions.deleted.deletedBy"),
      render: (row) => <span className="text-xs">{row.deletedByName || "—"}</span>,
    },
    {
      key: "deletionReason",
      header: t("transactions.deleted.reason"),
      render: (row) => (
        <span className="text-[11px] text-muted-foreground line-clamp-2 max-w-[220px] block">
          {row.deletionReason || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("transactions.actions"),
      align: "right",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            setRestoreTarget(row);
            setRestoreReason("");
          }}
        >
          {t("transactions.deleted.restore")}
        </Button>
      ),
    },
  ];

  if (forbidden) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-8 text-center">
        <Trash2 className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold text-foreground">{t("transactions.deleted.forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("transactions.deleted.eyebrow")}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-primary" />
            {t("transactions.deleted.title")}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("transactions.deleted.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          loading={query.isFetching}
          className="gap-1.5"
        >
          {!query.isFetching && <RefreshCw className="h-3.5 w-3.5" />}
          {t("transactions.refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("transactions.deleted.searchPlaceholder")}
            aria-label={t("transactions.deleted.searchPlaceholder")}
            className="w-64 pl-9 h-9 text-xs"
          />
        </div>
        <AppDropdown
          options={typeOptions}
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          placeholder={t("transactions.allTypes")}
        />
        <AppDropdown
          options={memberOptions}
          value={memberId}
          onChange={(v) => {
            setMemberId(v);
            setPage(1);
          }}
          placeholder={t("transactions.deleted.allMembers")}
        />
        <ERPDatePicker
          value={fromDate}
          onChange={(v) => {
            setFromDate(v);
            setPage(1);
          }}
          displayFormat={dateFormat}
          placeholder={t("transactions.deleted.fromDate")}
          max={toDate}
        />
        <ERPDatePicker
          value={toDate}
          onChange={(v) => {
            setToDate(v);
            setPage(1);
          }}
          displayFormat={dateFormat}
          placeholder={t("transactions.deleted.toDate")}
          min={fromDate}
        />
        <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters} icon={<FilterX size={13} />}>
          {t("transactions.deleted.clearFilters")}
        </Button>
      </div>

      <ERPDataTable<DeletedTransactionRow>
        data={rows}
        columns={columns}
        isLoading={query.isLoading}
        loadingRowCount={pageSize}
        rowKey={(row) => row.id}
        page={page}
        pageSize={pageSize}
        totalCount={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={query.isError ? t("transactions.deleted.loadFailed") : t("transactions.deleted.empty")}
      />

      <TopSheet
        open={restoreTarget !== null}
        onClose={() => {
          setRestoreTarget(null);
          setRestoreReason("");
        }}
        title={t("transactions.deleted.restoreTitle")}
        subtitle={
          restoreTarget
            ? t("transactions.deleted.restoreSubtitle", {
                ref: restoreTarget.referenceNumber || restoreTarget.id.slice(0, 8),
              })
            : undefined
        }
      >
        {restoreTarget && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl border border-border/80 bg-muted/40 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("transactions.type")}</span>
                <span className="font-semibold text-foreground">
                  {getTransactionTypeLabel(restoreTarget.type, t)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("transactions.amount")}</span>
                <span className="font-mono font-semibold text-foreground">
                  {formatMoney(restoreTarget.amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">{t("transactions.description")}</span>
                <span className="text-foreground text-right truncate">
                  {translateLedgerDescription(restoreTarget.description, t) || restoreTarget.description || "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">{t("transactions.deleted.reason")}</span>
                <span className="text-foreground text-right">{restoreTarget.deletionReason || "—"}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                {t("transactions.deleted.restoreReasonLabel")}
              </label>
              <textarea
                rows={3}
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder={t("transactions.deleted.restoreReasonPlaceholder")}
                className="w-full text-xs p-2.5 rounded-xl border border-border/80 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/80">
              <Button
                variant="outline"
                onClick={() => {
                  setRestoreTarget(null);
                  setRestoreReason("");
                }}
                disabled={restoreMutation.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                icon={RotateCcw}
                loading={restoreMutation.isPending}
                loadingLabel={t("transactions.deleted.restoring")}
                onClick={() =>
                  restoreMutation.mutate({ id: restoreTarget.id, reason: restoreReason.trim() })
                }
              >
                {t("transactions.deleted.confirmRestore")}
              </Button>
            </div>
          </div>
        )}
      </TopSheet>
    </div>
  );
}
