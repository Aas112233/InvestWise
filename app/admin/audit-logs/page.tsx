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

interface PlatformActionRow {
  id: string;
  adminUserId: string | null;
  adminEmail: string;
  actionType: string;
  targetType: string;
  targetId: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  details: unknown;
  ipAddress: string;
  createdAt: string;
}

interface ActionLogResponse {
  data: PlatformActionRow[];
  actionTypes: readonly string[];
  meta: { total: number; page: number; limit: number; pages: number };
}

type Tab = "tenant" | "platform";

export default function AdminAuditLogsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("platform");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string | null>(null);

  const auditQuery = useQuery<AuditLogResponse>({
    queryKey: ["admin", "audit-logs", { page, pageSize, search, action: actionFilter }],
    queryFn: () =>
      apiClient<AuditLogResponse>("/admin/audit-logs", {
        params: {
          page,
          limit: pageSize,
          search: search.trim(),
          action: actionFilter ?? undefined,
        },
      }),
    enabled: tab === "tenant",
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });

  const actionQuery = useQuery<ActionLogResponse>({
    queryKey: ["admin", "action-log", { page, pageSize, search, action: actionFilter }],
    queryFn: () =>
      apiClient<ActionLogResponse>("/admin/action-log", {
        params: {
          page,
          limit: pageSize,
          search: search.trim(),
          action: actionFilter ?? undefined,
        },
      }),
    enabled: tab === "platform",
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });

  const isFetching = tab === "platform" ? actionQuery.isFetching : auditQuery.isFetching;
  const refetch = tab === "platform" ? actionQuery.refetch : auditQuery.refetch;

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

  const platformColumns: ERPColumn<PlatformActionRow>[] = [
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
      key: "actionType",
      header: t("admin.auditLogs.action", { defaultValue: "Action" }),
      render: (row) => (
        <span className="font-mono text-[11px] font-semibold text-foreground">
          {row.actionType}
        </span>
      ),
    },
    {
      key: "adminEmail",
      header: t("admin.auditLogs.operator", { defaultValue: "Operator" }),
      render: (row) => (
        <span className="font-mono text-[11px] text-foreground truncate">{row.adminEmail}</span>
      ),
    },
    {
      key: "target",
      header: t("admin.actionLog.target", { defaultValue: "Target" }),
      render: (row) => (
        <div className="min-w-0">
          {row.tenantName ? (
            <p className="text-xs text-foreground truncate">{row.tenantName}</p>
          ) : null}
          <p className="font-mono text-[11px] text-muted-foreground truncate">
            {row.targetType === "Tenant" || !row.tenantName
              ? `${row.targetType}: ${row.targetId}`
              : row.targetType}
          </p>
        </div>
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
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

      {/* Tab switcher: platform control-plane actions vs tenant-scoped audit */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-border/80 bg-card p-1">
        {(
          [
            { id: "platform" as const, label: t("admin.actionLog.platformTab", { defaultValue: "Platform Actions" }) },
            { id: "tenant" as const, label: t("admin.actionLog.tenantTab", { defaultValue: "Tenant Audit" }) },
          ]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setPage(1);
              setActionFilter(null);
            }}
            className={
              tab === item.id
                ? "rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary border border-primary/20"
                : "rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "platform" ? (
        <ERPDataTable<PlatformActionRow>
          data={actionQuery.data?.data ?? []}
          columns={platformColumns}
          loading={actionQuery.isLoading}
          rowKey={(row) => row.id}
          page={page}
          pageSize={pageSize}
          totalCount={actionQuery.data?.meta.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          emptyMessage={t("admin.actionLog.empty", { defaultValue: "No platform actions recorded" })}
        />
      ) : (
        <ERPDataTable<AuditLogRow>
          data={auditQuery.data?.data ?? []}
          columns={columns}
          loading={auditQuery.isLoading}
          rowKey={(row) => row.id}
          page={page}
          pageSize={pageSize}
          totalCount={auditQuery.data?.meta.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          emptyMessage={t("admin.auditLogs.empty", { defaultValue: "No audit records found" })}
        />
      )}
    </div>
  );
}
