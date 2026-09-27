"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, FilterX, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPDatePicker } from "@/components/ui/erp-date-picker";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatDatePattern } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantDateFormat } from "@/lib/use-tenant-settings";
import type { PaginatedResponse } from "@/lib/utils/types";

interface AuditLog {
  id: string;
  userId?: string | null;
  userName?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt?: string;
  userEmail?: string | null;
  userRole?: string | null;
}

function actionTone(action: string): StatusTone {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("LOCK") || a.includes("SUSPEND") || a.includes("REVOKE") || a.includes("FAIL")) {
    return "rose";
  }
  if (a.includes("CREATE") || a.includes("LOGIN") || a.includes("APPROVE") || a.includes("SUCCESS")) {
    return "emerald";
  }
  if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("WARN") || a.includes("PENDING")) {
    return "amber";
  }
  if (a.includes("EXPORT") || a.includes("SYNC") || a.includes("NOTIF")) {
    return "cyan";
  }
  return "slate";
}

function renderDetails(details: unknown): string {
  if (details === null || details === undefined) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

// System audit log explorer. Server-driven search/filter/sort/pagination
// over GET /api/audit with the hierarchical ["audit", params] key (Rule §7);
// filter vocabularies come from GET /api/audit/metadata.
export function AuditLogsView() {
  const { t } = useLocale();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [inspected, setInspected] = useState<AuditLog | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const dateFormat = useTenantDateFormat();

  const { data: metadata } = useQuery({
    queryKey: ["audit", "metadata"],
    queryFn: () => apiClient<{ actions: string[]; resourceTypes: string[] }>("/audit/metadata"),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ["audit", { page, pageSize, search, action, resourceType, fromDate, toDate, sortOrder }],
    queryFn: () =>
      apiClient<PaginatedResponse<AuditLog>>("/audit", {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          action: action || undefined,
          resourceType: resourceType || undefined,
          startDate: fromDate || undefined,
          endDate: toDate || undefined,
          sortBy: "createdAt",
          sortOrder,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  useEffect(() => {
    if (query.error && !forbidden && query.error instanceof ApiError) {
      toast.error(query.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setAction(null);
    setResourceType(null);
    setFromDate(null);
    setToDate(null);
    setPage(1);
  };
  const hasFilters = search !== "" || action !== null || resourceType !== null || fromDate !== null || toDate !== null;

  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;

  const columns: ERPColumn<AuditLog>[] = [
    {
      key: "createdAt",
      header: t("audit.columns.timestamp"),
      sortable: true,
      render: (log) => (
        <span className="font-mono text-[11px] whitespace-nowrap">
          {formatDatePattern(log.createdAt, dateFormat, true)}
        </span>
      ),
    },
    {
      key: "userName",
      header: t("audit.columns.user"),
      render: (log) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{log.userName || "—"}</p>
          {log.userEmail && <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{log.userEmail}</p>}
        </div>
      ),
    },
    {
      key: "action",
      header: t("audit.columns.action"),
      render: (log) => <StatusBadge tone={actionTone(log.action)}>{log.action}</StatusBadge>,
    },
    {
      key: "resourceType",
      header: t("audit.columns.resource"),
      render: (log) => (
        <div className="text-[11px]">
          <p className="text-slate-700 dark:text-slate-200">{log.resourceType || "—"}</p>
          {log.resourceId && <p className="font-mono text-[10px] text-slate-400 truncate max-w-[160px]">{log.resourceId}</p>}
        </div>
      ),
    },
    {
      key: "ipAddress",
      header: t("audit.columns.ip"),
      render: (log) => <span className="font-mono text-[11px]">{log.ipAddress || "—"}</span>,
    },
    {
      key: "details",
      header: t("audit.columns.details"),
      align: "right",
      render: (log) => (
        <button
          type="button"
          aria-label={t("audit.detailsTitle")}
          onClick={() => setInspected(log)}
          className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Eye size={15} />
        </button>
      ),
    },
  ];

  const actionOptions = (metadata?.actions ?? []).map((a) => ({ value: a, label: a }));
  const resourceOptions = (metadata?.resourceTypes ?? []).map((r) => ({ value: r, label: r }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("audit.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("audit.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} loading={query.isFetching} icon={<RefreshCw size={13} />}>
          {t("members.refresh")}
        </Button>
      </div>

      {forbidden ? (
        <div role="alert" className="bg-card p-8 rounded-xl border border-border/80 shadow-sm text-center">
          <ShieldAlert size={20} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium text-foreground">{t("audit.forbidden")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("audit.forbiddenDetails")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div className="relative lg:col-span-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("audit.searchPlaceholder")}
                aria-label={t("audit.searchPlaceholder")}
                className="w-full bg-card pl-9 pr-3 py-2 rounded-lg border border-border/80 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
            </div>
            <AppDropdown
              options={actionOptions}
              value={action}
              onChange={(v) => {
                setAction(v);
                setPage(1);
              }}
              placeholder={t("audit.allActions")}
            />
            <AppDropdown
              options={resourceOptions}
              value={resourceType}
              onChange={(v) => {
                setResourceType(v);
                setPage(1);
              }}
              placeholder={t("audit.allResources")}
            />
            <ERPDatePicker
              value={fromDate}
              onChange={(v) => {
                setFromDate(v);
                setPage(1);
              }}
              displayFormat={dateFormat}
              placeholder={t("audit.fromDate")}
              max={toDate}
            />
            <ERPDatePicker
              value={toDate}
              onChange={(v) => {
                setToDate(v);
                setPage(1);
              }}
              displayFormat={dateFormat}
              placeholder={t("audit.toDate")}
              min={fromDate}
            />
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters} icon={<FilterX size={13} />}>
                {t("audit.clearFilters")}
              </Button>
            </div>
          </div>

          <ERPDataTable
            data={rows}
            columns={columns}
            isLoading={query.isLoading}
            loadingRowCount={pageSize}
            sortBy="createdAt"
            sortOrder={sortOrder}
            onSort={() => {
              setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            rowKey={(log) => log.id}
            page={page}
            pageSize={pageSize}
            totalCount={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            emptyMessage={query.isError ? t("audit.loadFailed") : t("common.noData")}
          />
        </>
      )}

      <TopSheet
        open={inspected !== null}
        onClose={() => setInspected(null)}
        title={t("audit.detailsTitle")}
        subtitle={inspected ? `${inspected.action} — ${formatDatePattern(inspected.createdAt, dateFormat, true)}` : undefined}
      >
        {inspected && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.user")}</dt>
              <dd className="mt-0.5 text-foreground font-medium">{inspected.userName || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.ip")}</dt>
              <dd className="mt-0.5 font-mono text-foreground">{inspected.ipAddress || "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.resource")}</dt>
              <dd className="mt-0.5 text-foreground font-medium">
                {inspected.resourceType || "—"}
                {inspected.resourceId && <span className="block font-mono text-[10px] text-muted-foreground">{inspected.resourceId}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.status")}</dt>
              <dd className="mt-0.5">
                <StatusBadge tone="slate">{inspected.status || "—"}</StatusBadge>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.details")}</dt>
              <dd className="mt-1 p-3 rounded-xl border border-border/80 bg-muted/40 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground">
                {renderDetails(inspected.details) || t("audit.detailsEmpty")}
              </dd>
            </div>
            {inspected.userAgent && (
              <div className="sm:col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("audit.columns.userAgent")}</dt>
                <dd className="mt-0.5 text-[11px] text-muted-foreground break-words">{inspected.userAgent}</dd>
              </div>
            )}
          </dl>
        )}
      </TopSheet>
    </div>
  );
}
