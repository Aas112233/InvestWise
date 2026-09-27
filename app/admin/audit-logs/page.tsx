"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, ShieldAlert } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, Input } from "@/components/ui";

interface AuditLogRow {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: any;
  ipAddress: string;
  status: string;
  createdAt: string;
}

interface AuditLogResponse {
  data: AuditLogRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export default function AdminAuditLogsPage() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading, isFetching, refetch } = useQuery<AuditLogResponse>({
    queryKey: ["admin", "audit-logs", { page, pageSize, search, action: actionFilter }],
    queryFn: () =>
      apiClient<AuditLogResponse>("/admin/audit-logs", {
        params: {
          page,
          limit: pageSize,
          search: search.trim(),
          action: actionFilter,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });

  const columns: ERPColumn<AuditLogRow>[] = [
    {
      key: "createdAt",
      header: t("admin.auditLogs.timestamp", { defaultValue: "Timestamp" }),
      render: (row) => (
        <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "userName",
      header: t("admin.auditLogs.operator", { defaultValue: "Operator / User" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{row.userName}</p>
          {row.userId && (
            <p className="font-mono text-[10px] text-muted-foreground truncate">{row.userId}</p>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: t("admin.auditLogs.action", { defaultValue: "Action" }),
      render: (row) => (
        <span className="font-mono text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          {row.action}
        </span>
      ),
    },
    {
      key: "resource",
      header: t("admin.auditLogs.resource", { defaultValue: "Resource Target" }),
      render: (row) => (
        <span className="text-xs text-foreground">
          {row.resourceType} {row.resourceId ? `(${row.resourceId.slice(0, 8)}…)` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.auditLogs.status", { defaultValue: "Status" }),
      render: (row) => (
        <StatusBadge
          tone={row.status === "SUCCESS" ? "emerald" : "rose"}
          label={row.status}
        />
      ),
    },
    {
      key: "ipAddress",
      header: t("admin.auditLogs.ip", { defaultValue: "IP Address" }),
      render: (row) => (
        <span className="font-mono text-[11px] text-muted-foreground">{row.ipAddress}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            {t("admin.auditLogs.title", { defaultValue: "Platform Audit Logs" })}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("admin.auditLogs.search", { defaultValue: "Search logs…" })}
            className="w-56 h-9 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            loading={isFetching}
            className="gap-1.5"
          >
            {!isFetching && <RefreshCw className="h-3.5 w-3.5" />}
            {t("common.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>
      </div>

      <ERPDataTable<AuditLogRow>
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        rowKey={(row) => row.id}
        page={page}
        pageSize={pageSize}
        totalCount={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t("admin.auditLogs.empty", { defaultValue: "No audit records found" })}
      />
    </div>
  );
}
